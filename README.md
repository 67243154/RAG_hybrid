 **简体中文**

# RAG 知识库问答系统（混合检索版）

> 把任意文档（txt / md / pdf）变成一个**只依据你的资料回答、不瞎编**的 AI 问答机器人。
> 检索环节采用 **向量语义 + BM25 关键词 + RRF 融合 + Rerank 精排** 四级混合检索，并配有**可复现的评测闭环**。

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi&logoColor=white)
![DeepSeek](https://img.shields.io/badge/LLM-DeepSeek-4D6BFE)
![Embedding](https://img.shields.io/badge/Embedding-bge--small--zh-FF6F00)
![Rerank](https://img.shields.io/badge/Rerank-bge--reranker--base-8B5CF6)
![Vector DB](https://img.shields.io/badge/VectorDB-Chroma-5A4FCF)
![BM25](https://img.shields.io/badge/BM25-jieba+rank_bm25-22C55E)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 核心特性

| 特性 | 做法 | 价值 |
| --- | --- | --- |
| **混合检索** | 向量（吃语义）+ BM25（吃精确名词）双路召回 → **RRF 融合** → **Rerank 精排** | 精确名词、数字、换说法都能召回，且排得准 |
| **答得准（带来源）** | 检索最相关段落，让 LLM 据资料回答，返回来源段落 + 相关度 | 答案可追溯、可核对 |
| **不瞎编** | 系统提示强制「资料外就说无法回答」+ 低温度采样，并用负样本评测 | 拒答正确率 100% |
| **评测闭环** | 55 条评测集（fact/rewrite/comprehensive/negative），Hit@k / Recall@k / MRR + 答案准确率分开统计 | 数据驱动迭代，可复现 |

---

## 评测结果（硬数据）

**检索层**（55 条评测集：48 正样本 + 7 负样本）：

| 方法 | Hit@1 | Hit@3 | Hit@5 | Hit@10 | Recall@5 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| 单路向量 | 0.71 | 0.88 | 0.98 | 1.00 | 0.94 | 0.82 |
| 单路BM25 | 0.88 | 0.96 | 1.00 | 1.00 | 0.99 | 0.92 |
| RRF融合 | 0.81 | 1.00 | 1.00 | 1.00 | 0.99 | 0.90 |
| 加权融合 | 0.94 | 1.00 | 1.00 | 1.00 | 0.99 | 0.97 |
| **RRF+Rerank** | **0.98** | **1.00** | **1.00** | **1.00** | **1.00** | **0.99** |

结论：**RRF+Rerank 相对单路向量 Hit@1 提升 27 个百分点、MRR +0.17；相对 RRF 融合 Hit@1 提升 17 个百分点**。BM25 在精确名词类问题上显著优于向量，Rerank 进一步把正确段落顶到第一名。

**生成层**（需联网运行 `uv run python eval_rag.py` 刷新全量数据；20 条子集参考值：回答准确率 85.3%、拒答正确率 100%）。

复现方式：

```bash
uv run python eval_rag.py --retrieval-only   # 检索层（本地，免费）
uv run python eval_rag.py                    # 全量（含生成层，调 DeepSeek）
```

---

## 架构 / RAG 流程

```mermaid
flowchart LR
    subgraph 建库["① 建库（上传文档时）"]
        A[原始文档<br/>txt / md / pdf] --> B[切分 chunk<br/>按标题/段落, 400 字 + 80 重叠]
        B --> C1[本地 Embedding<br/>bge-small-zh]
        B --> C2[BM25 索引<br/>jieba 分词 + 自定义词典]
        C1 --> D[(Chroma<br/>向量库)]
    end
    subgraph 问答["② 问答（用户提问时）"]
        Q[用户问题] --> V[向量检索 Top-10]
        Q --> K[BM25 检索 Top-10]
        V --> F[RRF 融合<br/>score = Σ 1/(60+rank)]
        K --> F
        F --> R[Rerank 精排<br/>bge-reranker-base]
        R --> P[拼接参考资料 + 问题]
        P --> LLM[DeepSeek<br/>据资料作答]
        LLM --> ANS[答案 + 来源段落 + 相关度]
    end
    D --> V
```

---

## 快速开始

### 1. 准备 DeepSeek Key

去 [platform.deepseek.com](https://platform.deepseek.com/) 创建 API key。把 `.env.example` 复制成 `.env`，填入 key：

```bash
cp .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY=sk-你的key
```

### 2. 装依赖 + 启动（uv）

```bash
uv venv --python 3.12
uv pip install --python .\.venv\Scripts\python.exe -r requirements.txt
uv run uvicorn app.main:app --reload
```

> 首次启动会自动下载 embedding 模型（约 100MB）与 rerank 模型（约 500MB）。

### 3. 打开浏览器

访问 <http://127.0.0.1:8000>，上传示例文档后即可提问。

---

## 目录结构

```text
rag-knowledge-base-qa/
├── app/
│   ├── main.py            # FastAPI 接口 + 托管前端
│   ├── rag.py             # RAG 核心：切分 → 向量化 → BM25 → RRF → Rerank → 生成
│   ├── bm25.py            # BM25 索引（jieba 分词 + rank_bm25 + 自定义词典）
│   ├── rerank.py          # Rerank 精排（bge-reranker-base cross-encoder）
│   └── static/index.html  # 前端页面
├── data/
│   ├── docs/              # 上传的原始文档
│   ├── domain_dict.txt    # jieba 自定义词典（领域专有名词）
│   └── chroma/            # 向量库（自动生成）
├── eval/
│   ├── qa_set.json        # 评测集（55 条，含负样本）
│   └── results/           # 评测输出（报告 / 指标 / bad case 台账）
├── eval_rag.py            # 评测脚本（Hit@k / Recall@k / MRR / 答案准确率）
├── requirements.txt
├── .env.example
└── README.md
```

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 后端 | **FastAPI** | 轻量异步 Web 框架 |
| 大模型 | **DeepSeek**（`deepseek-chat`） | 生成最终答案 |
| Embedding | **bge-small-zh-v1.5**（本地） | 中文语义向量化，数据不出本地 |
| 关键词检索 | **jieba + rank_bm25** | 精确名词/数字兜底，自定义词典合并领域专名 |
| 融合 | **RRF + 加权融合**（自实现） | 双路按名次融合，另实现加权对比 |
| 精排 | **bge-reranker-base**（本地） | cross-encoder 对候选重打分 |
| 向量库 | **Chroma**（本地持久化） | 文件存盘，免部署 |
| 评测 | **自建 55 条评测集 + LLM-as-judge** | Hit@k / Recall@k / MRR + 答案准确率 |

## 可拓展方向

- 接入微信公众号 / 企业微信 / 飞书机器人
- 支持更多格式：Word、Excel、网页抓取
- 多轮对话记忆
- 流式输出（SSE）、来源高亮
- 评测集扩到 100+ 条，加入人工复核流程

---

## License

[MIT](./LICENSE) © Sunruising