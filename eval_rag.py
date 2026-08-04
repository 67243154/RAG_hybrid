# -*- coding: utf-8 -*-
"""RAG 评测闭环：检索层(Hit@k / Recall@k / MRR) + 生成层(答案准确率 / 拒答率)。

用法：
    uv run python eval_rag.py                 # 全量（检索层 + 生成层，生成层调 DeepSeek）
    uv run python eval_rag.py --retrieval-only  # 只跑检索层（免费、快，调试用）

输出：
    eval/results/metrics.json      指标汇总
    eval/results/eval_report.md    对比表（可直接贴 README）
    eval/results/answers.json      生成层答案缓存（避免重复调 API）
    eval/results/bad_cases.json    bad case 台账
"""
import json
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # 读取 .env 里的 DEEPSEEK_API_KEY

from app.rag import RagEngine  # noqa: E402

QA_PATH = Path("eval/qa_set.json")
RESULT_DIR = Path("eval/results")
KS = (1, 3, 5, 10)
METHODS = ["vector", "bm25", "rrf", "weighted", "rrf_rerank"]
METHOD_NAMES = {
    "vector": "单路向量",
    "bm25": "单路BM25",
    "rrf": "RRF融合",
    "weighted": "加权融合",
    "rrf_rerank": "RRF+Rerank",
}


# ---------- 检索层 ----------
def run_method(engine, method, question, k=10):
    if method == "vector":
        return engine.retrieve(question, k=k)
    if method == "bm25":
        return engine.retrieve_bm25(question, k=k)
    if method == "rrf":
        return engine.retrieve_hybrid(question, k=k)
    if method == "weighted":
        return engine.retrieve_weighted(question, k=k)
    if method == "rrf_rerank":
        cand = engine.retrieve_hybrid(question, k=10)
        return engine.reranker.rerank(question, cand, top_k=10)
    raise ValueError(f"未知检索方法: {method}")


def first_rank(chunks, gold_texts):
    """gold_texts 中任一段第一次出现在第几名；没命中返回 0"""
    for rank, c in enumerate(chunks, start=1):
        if any(gt and gt in c["text"] for gt in gold_texts):
            return rank
    return 0


def matched_count(chunks, gold_texts):
    """top-k 里命中了几个 gold_text"""
    joined = " ".join(c["text"] for c in chunks)
    return sum(1 for gt in gold_texts if gt and gt in joined)


def eval_retrieval(engine, qa_set):
    stat = {
        m: {
            "hit": {k: 0 for k in KS},
            "recall": {k: 0.0 for k in KS},
            "rr": 0.0,
            "n": 0,
        }
        for m in METHODS
    }
    for item in qa_set:
        if item["type"] == "negative":
            continue
        golds = [g for g in item.get("gold_texts", []) if g]
        if not golds:
            continue
        for m in METHODS:
            topk = run_method(engine, m, item["question"], k=max(KS))
            rank = first_rank(topk, golds)
            for k in KS:
                stat[m]["hit"][k] += 1 if 0 < rank <= k else 0
                stat[m]["recall"][k] += matched_count(topk[:k], golds) / len(golds)
            stat[m]["rr"] += 1.0 / rank if rank > 0 else 0.0
            stat[m]["n"] += 1
    return stat


def retrieval_table(stat):
    lines = [
        "### 检索层对比",
        "",
        "| 方法 | Hit@1 | Hit@3 | Hit@5 | Hit@10 | Recall@5 | MRR |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for m in METHODS:
        s = stat[m]
        n = max(s["n"], 1)
        lines.append(
            "| {name} | {h1:.2f} | {h3:.2f} | {h5:.2f} | {h10:.2f} | {r5:.2f} | {mrr:.2f} |".format(
                name=METHOD_NAMES[m],
                h1=s["hit"][1] / n,
                h3=s["hit"][3] / n,
                h5=s["hit"][5] / n,
                h10=s["hit"][10] / n,
                r5=s["recall"][5] / n,
                mrr=s["rr"] / n,
            )
        )
    return "\n".join(lines) + "\n"


# ---------- 生成层 ----------
def judge(engine, question, gold_answer, model_answer):
    """LLM-as-judge：返回 0 / 0.5 / 1"""
    prompt = (
        "你是一个严格但公平的判卷员。\n"
        f"【问题】{question}\n"
        f"【标准答案】{gold_answer}\n"
        f"【模型回答】{model_answer}\n"
        "请判断模型回答是否准确回答了问题：完全正确输出 1，"
        "部分正确或信息不全输出 0.5，错误或答非所问输出 0。只输出数字。"
    )
    resp = engine._get_llm().chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
    )
    text = (resp.choices[0].message.content or "").strip()
    m = re.search(r"0\.5|1|0", text)
    return float(m.group(0)) if m else 0.0


def eval_answer(engine, qa_set):
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = RESULT_DIR / "answers.json"
    cache = {}
    if cache_file.exists():
        cache = json.loads(cache_file.read_text(encoding="utf-8"))

    # 1) 生成答案（有缓存则不重复调 API）
    for item in qa_set:
        q = item["question"]
        if q not in cache:
            cache[q] = engine.answer(q)["answer"]
    cache_file.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 2) 打分 + 记录每题得分（bad case 复用）
    acc, n_pos = 0.0, 0
    reject_ok, n_neg = 0, 0
    scores = {}  # {question: judge得分}，仅正样本
    for item in qa_set:
        q = item["question"]
        ans = cache[q]
        if item["type"] == "negative":
            n_neg += 1
            reject_ok += 1 if "无法回答" in ans else 0
        else:
            sc = judge(engine, q, item["gold_answer"], ans)
            scores[q] = sc
            acc += sc
            n_pos += 1

    return {
        "answer_accuracy": round(acc / n_pos, 3) if n_pos else None,
        "reject_rate": round(reject_ok / n_neg, 3) if n_neg else None,
    }, scores


def answer_table(answer_stats):
    return (
        "### 生成层对比\n\n"
        "| 指标 | 数值 |\n| --- | --- |\n"
        f"| 回答准确率（正样本） | {answer_stats['answer_accuracy']} |\n"
        f"| 拒答正确率（负样本） | {answer_stats['reject_rate']} |\n\n"
    )


# ---------- bad case 台账 ----------
def collect_bad_cases(engine, qa_set, answers, scores):
    cases = []
    for item in qa_set:
        q = item["question"]
        if item["type"] == "negative":
            ans = answers.get(q, "")
            if ans and "无法回答" not in ans:   # 没答案(检索模式)不算误答
                cases.append({
                    "id": item["id"], "type": "negative", "question": q,
                    "model_answer": answers.get(q, ""), "fail": "负样本误答（应该拒答）",
                })
            continue
        golds = [g for g in item.get("gold_texts", []) if g]
        topk = run_method(engine, "rrf", q, k=10)
        rank = first_rank(topk, golds)
        if rank == 0:
            cases.append({
                "id": item["id"], "type": item["type"], "question": q,
                "fail": "检索漏了（RRF top-10 没命中 golden）",
                "top1": topk[0]["text"][:60] if topk else "",
            })
        elif q in scores and scores[q] < 0.5:   # 没有 judge 分数(检索模式)不判答错
            cases.append({
                "id": item["id"], "type": item["type"], "question": q,
                "fail": "检索到了但答错", "gold_answer": item["gold_answer"],
                "model_answer": answers.get(q, ""),
            })
    return cases


# ---------- main ----------
def main():
    retrieval_only = "--retrieval-only" in sys.argv

    qa_set = json.loads(QA_PATH.read_text(encoding="utf-8"))
    print(f"评测集: {len(qa_set)} 条")

    engine = RagEngine()
    print("知识库:", engine.status())

    print("\n[1/2] 检索层指标（不调 LLM）...")
    ret = eval_retrieval(engine, qa_set)
    table = retrieval_table(ret)
    print(table)

    if retrieval_only:
        print("已跳过生成层（--retrieval-only）。")
        ans, scores = {}, {}
    else:
        print("[2/2] 生成层指标（调用 DeepSeek，耗时较长）...")
        ans, scores = eval_answer(engine, qa_set)
        table += "\n" + answer_table(ans)
        print(answer_table(ans))

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    answers = {}
    if (RESULT_DIR / "answers.json").exists():
        answers = json.loads((RESULT_DIR / "answers.json").read_text(encoding="utf-8"))
    bad = collect_bad_cases(engine, qa_set, answers, scores)
    (RESULT_DIR / "bad_cases.json").write_text(
        json.dumps(bad, ensure_ascii=False, indent=2), encoding="utf-8")

    metrics = {
        "qa_count": len(qa_set),
        "retrieval": ret,
        "generation": ans,
        "bad_case_count": len(bad),
    }
    (RESULT_DIR / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    (RESULT_DIR / "eval_report.md").write_text(table, encoding="utf-8")

    print(f"\n结果已写入 {RESULT_DIR}/")
    print(f"bad case 数: {len(bad)}")


if __name__ == "__main__":
    main()