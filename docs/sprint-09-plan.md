# Sprint 9 计划 — 评估

## 目标

建立可通过命令运行的 golden set 质量评估框架，按内容格式（PDF 与 Markdown）报告检索和生成指标。复用 `production-rag-platform` 已验证的 DeepEval + 本地评估模型方案，不再重复讨论 RAGAS 与 DeepEval 的选择。

## 不再尝试 RAGAS

`production-rag-platform` 曾实际尝试 RAGAS，因已记录的依赖冲突而放弃，并非偏好选择。本 sprint 直接采用 DeepEval 和本地 Ollama 评估模型，对齐该项目 `app/evaluation/generation_metrics.py` 的参考设计。

## 评估模型：qwen2.5:7b-instruct

生产项目的真实测试发现 `qwen2.5:3b-instruct` 作为评估模型时，文字理由与数值判定不一致；同一测试中 7B 模型修复了该问题。本项目已经拉取 `qwen2.5:7b-instruct`，它也是默认 `ollama_model`，但 golden set 运行会使用更小的生成模型，以验证模型切换场景。

## 两个已避免的真实问题

1. **模型切换抖动**：交错调用评估模型和生成模型会使 Ollama 频繁重载，约 11 分钟的任务可能超过 40 分钟。`run_evaluation()` 固定为两阶段：阶段 1 先完成所有问题的检索+生成，阶段 2 再完成所有评估；每个阶段只加载一个模型。golden set 明确使用 `qwen2.5:3b-instruct` 生成、`qwen2.5:7b-instruct` 评估，以实际覆盖该场景。
2. **OllamaClient 超短超时**：本项目的 `app/llm/ollama_client.py::OllamaClient` 已在 Sprint 0 将默认超时设为 `DEFAULT_TIMEOUT_SECONDS = 120.0`。DeepEval 的 `OllamaModel` 使用官方 `ollama` 包的独立 HTTP 客户端，默认 `timeout=None` 表示不限制超时，并不复现旧问题，因此不额外添加超时覆盖。

## 检索指标与位置身份

PDF 专用的 `Location = tuple[int, int]` 不适合多来源架构。本项目使用 `app/llm/grounding.py` 已采用的 `(source_type, source_id, location)` 三元组；`location` 由 `app/llm/citation_location.py::location_for()` 生成（Markdown 为标题路径，PDF 为 `page/paragraph`）。`app/evaluation/retrieval_metrics.py` 使用相同身份，因此精确率/召回率是确定性的集合交集计算，无需评估模型。

## content_type 与 source_type

本 sprint 的问题是“PDF 还是 Markdown 更弱”，属于格式而非连接器问题。`source_type` 标识连接器，`content_type` 标识格式；本项目两种格式都来自 `LocalFilesystemConnector`（`source_type="filesystem"`）。每个 `GoldenQuestion` 带有 `content_type`（`"pdf"` / `"markdown"`），`build_report()` 同时计算全局指标和各格式均值。

## Golden set：只使用真实内容

- **PDF**：复用 `tests/fixtures/golden_source.py` 的 Nimbus Cloud Storage 手册构建器（6 页）。
- **Markdown**：新增 `tests/fixtures/golden_markdown_source.py`，构造包含安装、认证、同步参数和故障排查的 Nimbus CLI 多标题参考文档。
- **Notion**：因本机未设置 `NOTION_API_KEY` 而排除，不用 mock 替代，并在结果中明确说明。

两个 fixture 都通过真实 `ingest_connector()`、真实本地 Qdrant 和 Ollama 嵌入导入；`expected_locations` 从实际分块后的 payload 通过 `location_for()` 读取，而不是预先猜测。

## 框架设计

`app/evaluation/` 包含：

- `retrieval_metrics.py`：`RetrievalMetrics` 与三元组检索指标计算。
- `generation_metrics.py`：构建 `LLMTestCase`，运行 `FaithfulnessMetric`/`AnswerRelevancyMetric`，并通过 `deepeval.models.OllamaModel` 配置默认评估器。
- `harness.py`：`GoldenQuestion`、`QuestionResult`、`load_golden_set()`、两阶段 `run_evaluation()`、按全局及 `content_type` 汇总的 `build_report()`。
- `cli.py`：`python -m app.evaluation.cli --golden-set <path>`，连接真实 Ollama、Qdrant、稀疏编码器和可选重排序器，输出 JSON 报告。

## 测试范围

单元测试覆盖检索精确率/召回率、生成指标聚合、两阶段顺序和格式拆分。真实 Ollama、Qdrant、7B 评估模型的 golden set 运行作为手工端到端验证并在 Sprint 9 收尾记录中保存真实输出，不放入 CI，以避免耗时和环境依赖。
