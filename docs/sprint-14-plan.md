# Sprint 14 计划 — 摄取性能

## 目标

修正会误导读者的命名，给嵌入调用增加真实的有界并发，并用原生 Ollama 基准而不是猜测选择默认并发数。

## `batch_size` 改为 `upsert_batch_size`

确认 `app/ingestion/ingest.py` 中该参数控制一次 `store.upsert_chunks(...)` 的块数，从未控制嵌入批处理；`embed_fn` 仍是每个块调用一次。因此全局重命名为 `upsert_batch_size`，span 属性 `upsert.chunk_count`/`embed.chunk_count` 已正确，不改行为。

## 有界嵌入并发

新增 `embed_texts_concurrently(texts: list[str], embed_fn: EmbedFn, concurrency: int) -> list[list[float]]`。用 `asyncio.Semaphore(concurrency)` 保护每个 `embed_fn`，通过 `asyncio.gather` 并发启动，并依靠 gather 保持输入顺序。`ingest_path` 与 `ingest_connector` 共用该逻辑。`sparse_encoder.embed_document()` 仍串行，因为它是本地 CPU 工作而非网络调用。

新增 `Settings.embedding_concurrency`，默认值由真实基准结果确定，不凭经验猜测。

## 验证与基准

并发测试使用会记录在途数量和最大值的 fake `embed_fn`，直接断言实际并发数等于配置值，而不是只比较总耗时。基准脚本 `scripts/benchmarks/benchmark_embedding_concurrency.py` 在真实 Ollama 上测试并发 1、2、4、8，块数 10、100、1000，报告每种组合的耗时和 chunks/sec。无论结果是加速、平台期还是退化，都按实际结果选择默认值；脚本不纳入 CI，因为 CI 不启动 Ollama。

## README

新增吞吐章节，记录真实基准表及默认并发下的一次真实同步拆分（总耗时、嵌入耗时、Qdrant upsert 耗时），数据来自 Sprint 8 已有的 `embed_batch` 和 `upsert_batch` OTel span。
