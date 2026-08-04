"""验收：单路向量 vs 单路 BM25 的 Hit Rate@10 对比。

用法（先确保 Chroma 里已有文档，或先启动过一次服务）：
    python bm25_eval.py
结果写入 data/eval_bm25_result.json
"""
import json

from app.rag import RagEngine

# 验收问题集：每个问题配一个"必须出现在命中段落里"的精确关键词
GOLD = [
    # ========== BM25 优势题（精确数字/术语）==========
    {"q": "单笔报销超过多少元要部门负责人书面审批？", "kw": "2000"},
    {"q": "忘记密码可以拨打哪个热线？", "kw": "8000"},
    {"q": "费用发生后多久必须提交报销？", "kw": "30天"},
    {"q": "体检通常安排在每年的哪个月份？", "kw": "10月"},
    {"q": "一线城市差旅住宿每晚上限是多少？", "kw": "500元"},

    # ========== 向量优势题（同义/语义转换）==========
    {"q": "新员工入职会配什么办公硬件？", "kw": "笔记本电脑"},
    {"q": "远程办公每月可以申请几天？", "kw": "弹性办公"},
    {"q": "工作满一年能休多少天带薪假？", "kw": "年假"},
    {"q": "生病了请病假需要医院开什么级别的证明？", "kw": "二级以上医院"},
    {"q": "公司给员工买了哪些保险？", "kw": "六险一金"},

    # ========== RRF 融合优势题（语义+关键词都需要）==========
    {"q": "在一线城市出差住酒店，每晚最多能报销多少钱？", "kw": "500元"},
    {"q": "如果身体不舒服需要请病假，要提交什么证明材料？", "kw": "二级以上医院证明"},
    {"q": "除了打电话，还有什么方式可以重置公司账号密码？", "kw": "it.xingchen.local"},
    {"q": "公司提供的健康保障除了社保还有什么？", "kw": "补充商业医疗保险"},
    {"q": "做 RAG 时为什么要同时用关键词和语义两种检索？", "kw": "混合检索"},
]



def main():
    engine = RagEngine()                       # 会加载 embedding 模型，稍慢
    print("知识库状态:", engine.status())

    rows = []
    for g in GOLD:
        vec = engine.retrieve(g["q"], k=10)    # 向量 top-10
        bm = engine.retrieve_bm25(g["q"], k=10)  # BM25 top-10
        rrf = engine.retrieve_hybrid(g["q"], k=10)
        wgt = engine.retrieve_weighted(g["q"], k=10)
        vec_texts = " ".join(h["text"] for h in vec)
        bm_texts = " ".join(h["text"] for h in bm)
        rrf_hit = g["kw"] in " ".join(h["text"] for h in rrf)
        wgt_hit = g["kw"] in " ".join(h["text"] for h in wgt)
        rows.append({
            **g,
            "vector_hit": g["kw"] in vec_texts,
            "bm25_hit": g["kw"] in bm_texts,
            "rrf_hit": rrf_hit,  # ← 加上
            "wgt_hit": wgt_hit,  # ← 加上
            "vector_top1": (vec[0]["text"][:40] if vec else ""),
            "bm25_top1": (bm[0]["text"][:40] if bm else ""),
        })

    v_hits = sum(r["vector_hit"] for r in rows)
    b_hits = sum(r["bm25_hit"] for r in rows)
    rrf_hits = sum(r["rrf_hit"] for r in rows)

    n = len(rows)
    best_single = max(v_hits, b_hits) / n
    print(f"\n=== Hit Rate@10 ===")
    print(f"单路向量 : {v_hits}/{n} = {v_hits/n:.0%}")
    print(f"单路BM25 : {b_hits}/{n} = {b_hits/n:.0%}")
    print(f"混合rrf： : {rrf_hits}/{n} = {rrf_hits/n:.0%}")

    print("\n=== BM25 命中而向量漏掉的 case（验收重点）===")
    for r in rows:
        if r["bm25_hit"] and not r["vector_hit"]:
            print(f"  [{r['kw']}] {r['q']}")
            print(f"    向量top1: {r['vector_top1']!r}")
            print(f"    BM25top1: {r['bm25_top1']!r}")
            print(f"    RRFtop1: {r['rrf_top1']!r}")

    result = {
        "vector_hit_rate_10": v_hits / n,
        "bm25_hit_rate_10": b_hits / n,
        "cases": rows,
    }
    with open("data/eval_bm25_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("\n结果已写入 data/eval_bm25_result.json")

    print(f"RRF 是否超过两条单路: {'✅' if rrf_hits / n >= best_single else '❌ 需要调 k 或加大数据集'}")

if __name__ == "__main__":
    main()