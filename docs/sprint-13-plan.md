# Sprint 13 计划 — 安全的版本化重索引

## 目标

关闭 `ingest_connector` 重索引的数据丢失窗口。旧流程在新内容解析、嵌入和 upsert 前先删除旧块；中途失败会让文档不可搜索。

## 修复：延迟清理，而非严格原子

先完整写入新版本，再删除旧版本。这不是事务原子交换，而是“零停机版本化重索引 + 延迟清理”：新旧版本在短暂窗口内都可搜索，查询可能同时返回重复或旧内容；Qdrant 不提供本 sprint 所需的原子性，因此保留并测量该权衡。

新增 `document_version` payload 字段（值与 `doc_id` 相同），使清理意图明确。新增 `QdrantStore.delete_stale_versions(source_type, source_id, keep_version)`，删除匹配来源但版本不等于 `keep_version` 的点；无版本过滤的 `delete_by_source` 继续用于连接器中完全消失的文档。

## 新顺序

1. 解析和分块，`Chunk` 携带 `document_version=content_hash`。
2. 完成每一批嵌入和 upsert，期间不删除旧版本。
3. 全部 upsert 成功后调用 `delete_stale_versions(..., keep_version=content_hash)`。
4. 更新 registry。

若嵌入失败，旧块保持可搜索；若清理失败，新旧版本共存，并在下一次同步中重试。该过程不吞异常，重复执行相同 `content_hash` 是幂等的。

## 验证计划

- 使用真实多批次文档，在嵌入中途抛错，确认旧版本文本仍在 store 中。
- 在最后一次 upsert 与清理之间用真实内存 Qdrant 捕获两个 `document_version` 同时存在的窗口。
- 通过 `InMemorySpanExporter` 比较最后一个 `upsert_batch` 与 `delete_stale_chunks` 的 OTel 时间戳，报告实际窗口时长。
- 重新运行 Sprint 4/5 的同步和引用隔离测试，确认它们依赖最终状态而非旧的删除顺序。

## 范围边界

不在查询时去重或优先最新 `document_version`；`app/retrieval/search.py` 和 `hybrid_search.py` 不改动。
