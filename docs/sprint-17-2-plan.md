# Sprint 17.2 — 索引对账

## 背景（规划前阅读，不得凭假设）

Sprint 17.1 的收尾记录报告了 393 个测试通过、`ruff` 检查干净，并新增了快速失败的 index-schema-version 迁移守卫（`DocumentRegistry.ensure_index_schema_version()`，在 `build_app()` 启动时调用一次）。第五次审查指出了一个该守卫无法解决的更广泛架构缺口：**registry 和 Qdrant 是两个独立的持久化存储，而系统从未重新验证它们是否仍然一致。** `ingest_connector` 的跳过决策（`app/ingestion/ingest.py`，`registry.has_changed(...)`）只会询问“该内容的哈希是否不同于 registry 上次记录的哈希”——它不会询问“该文档的 points 是否仍然实际存在于 Qdrant 中”。如果 Qdrant 因为本应用自身 delete 调用以外的任何原因丢失数据——手动执行 `DELETE`、重启没有挂载 volume 的 `:memory:`/临时 Qdrant、运维人员只对 Qdrant 服务执行 `docker compose down -v`、部分恢复备份——registry 都无法察觉。该文档会永远被跳过（直到其内容下一次真正变化），在搜索结果中静默缺失，没有错误、没有日志、什么都没有。

已直接通过代码确认：

- `app/ingestion/ingest.py` 的 `check_document` 块：`changed = registry.has_changed(connector.source_type, document.source_id, content_hash)`；`if not changed: files_skipped += 1; continue`——这就是全部的跳过决策。该路径完全不会读取 Qdrant。
- `QdrantStore`（`app/ingestion/qdrant_store.py`）没有方法检查某个给定的 `(source_type, source_id, document_version)` 是否实际存在任何 points——`count()` 存在，但它统计的是整个 collection，不支持过滤。
- `DocumentRegistry` 跟踪 `content_hash`、`version`（编辑计数器，不是 index schema version），以及现在的 `index_schema_version` 元数据——但没有跟踪一个文档产生了多少 chunks，因此无法比较“registry 预计有 N 个 chunks”和“Qdrant 实际有 M 个”。
- `DocumentRegistry.get_index_schema_version()` 直接对存储的元数据值执行 `int(row[0])`，没有错误处理——直接复现确认：向 `registry_metadata.value` 中的 `index_schema_version` key 写入非数字字符串，再调用 `ensure_index_schema_version()` 会抛出原始 `ValueError`（“invalid literal for int()...”），而不是预期的 `IndexSchemaMismatchError`。
- `ensure_index_schema_version()` 唯一真正的分支条件是 `stored == CURRENT_INDEX_SCHEMA_VERSION`（返回）与其他所有情况（经过全新空 registry 特殊分支后抛出异常）——存储版本*高于* `CURRENT_INDEX_SCHEMA_VERSION`（例如由更新版本代码构建的 registry 后运行了降级版本的应用）当前也不会被特殊接受，而是进入同一个“抛出异常”路径。通过阅读逻辑已确认它应该正确工作，但没有测试证明这一点——目前只测试了相同版本或落后版本的场景。
- README 开头段落（第 7 行）仍然写着“...cross-encoder reranking, grounded generation with citations, OpenTelemetry tracing)...”——这是 Sprint 17 和 Sprint 17.1 中其他地方都已修复后唯一残留的 “grounded” 措辞。
- `docker-compose.yml`：已确认 `qdrant_storage` 和 `registry_data` 都是命名 volume，`docker compose down -v` 会同时清除它们——`IndexSchemaMismatchError` 自身文案记录的迁移修复路径已经让两个存储保持同步清除，而不是只清 registry。

## 范围

### 1. `QdrantStore.has_document_version(...)`

新增方法：`has_document_version(source_type: str, source_id: str, document_version: str) -> bool`——执行一次廉价的存在性检查（针对三个字段的过滤器调用 `client.scroll(..., limit=1)`，`len(points) > 0`），而不是精确计数。这是第 2 项对账检查所构建于其上的基础能力。

### 2. 增量同步要求内容未变化且索引存在

`ingest_connector` 的跳过条件从 `if not changed:` 改为：内容未变化仍是必要条件，但不再充分；只有当 `store.has_document_version(...)` 同时确认 points 仍然存在时，文档才会被跳过。如果内容未变化但索引副本已经消失，文档会被当作“已变化”，进入正常的（Sprint 13/16/17 已经保证安全的）重新摄取路径——不增加新的代码路径，只扩大现有路径的触发条件。

**性能**：这会为每个“已经被判定为未变化、原本会跳过”的文档增加一次 Qdrant 往返——这是每次增量同步的常见情况，所以成本是真实存在的，并非只影响边界场景。通过结构设计进行缓解：检查只针对已经通过 `registry.has_changed()` 检查的文档运行，前者是廉价的本地无网络操作；内容已变化的文档本来就要支付完整的重新嵌入和 upsert 成本，在该路径上再增加一次 Qdrant 调用影响很小；该对账检查完全跳过了这个分支。`scroll(..., limit=1)` 是一个廉价的 point-lookup 风格查询（结果数量有界、payload filter 有索引），不是 collection 扫描。这里不尝试把多个文档合并为一次查询，因为 `ingest_connector` 在 upsert 时已经针对每个变化文档执行一次 Qdrant 往返，本方案沿用既有的逐文档调用模式；批量化是一个真实存在但独立的优化，不属于本 sprint 范围（目前项目同步的文档量还没有大到被测量为实际瓶颈——参见 Sprint 14 embedding-throughput benchmark 的结论：Qdrant 写路径从未成为瓶颈，而读/元数据调用也不是瓶颈）。

**测试先行，复现审查指出的确切场景**：真实文件夹 → 真实（`:memory:`）Qdrant + 真实 SQLite registry，执行一次真实的 `ingest_connector`。然后**直接手动删除 Qdrant 中该文档的 points**（`store.delete_by_source(...)`，模拟外部数据丢失——完全不触碰 registry，因此 `content_hash` 保持不变）。再次执行 `ingest_connector`：断言该文档**没有**被跳过（真实发生重新嵌入/重新 upsert，`stats.files_processed` 包含它，`files_skipped` 不包含它），并断言之后其 points 已恢复到 Qdrant。

### 3. 加分项：通过 `chunk_count` 检测部分索引

第 1/2 项可以捕获“完全消失”（零 points），但无法捕获“部分消失”（多 chunk 文档只缺少部分 points——例如外部/手动清理期间崩溃，而不是本应用自身的写入；本应用自身的写入已经由 Sprint 13/16 做了延迟清理安全处理）。由于实现可行，纳入本范围：

- `DocumentRegistry`：在 `documents` 表中新增 `chunk_count` 列（对现有 registry 执行真正的 `ALTER TABLE ... ADD COLUMN` 迁移，并通过 `PRAGMA table_info` 检查进行保护，因为旧 registry 早于该列，而单独使用 `CREATE TABLE IF NOT EXISTS` 不会将列添加到已有表中）。`DocumentRecord` 新增 `chunk_count: int = 0`（提供默认值，因此所有已有的构造调用点——包括测试——都能继续工作）。`upsert_document(...)` 新增可选参数 `chunk_count: int | None = None`；`ingest_connector` 在成功重建索引后调用 `upsert_document` 时传入 `len(chunks)`。
- `QdrantStore.count_for_document_version(...)`：执行精确计数（`client.count(..., count_filter=..., exact=True)`），成本高于只检查存在性的 `has_document_version`——只有当 `has_document_version` 已返回 `True`（至少确认有一个 point 存在），且 registry 中记录了非零 `chunk_count` 时才会调用它进行比较（迁移前没有追踪计数的 registry 行，其列默认值为 `chunk_count == 0`，不会触发无意义的重新索引；这种情况与“没有计数预期、只有存在性检查”相同）。这使昂贵的精确计数调用很少发生：只针对未变化、存在、并且已经有实际预期计数记录的文档。
- 跳过条件变为：未变化且存在，并且（没有追踪的预期计数，或实际计数相等）。如果计数不匹配（存在但数量错误），则按“缺失”处理——执行完整的重新摄取，而不是局部修补（与本项目已有的“重新嵌入整个文档”理念一致，从不执行局部 chunk 修补）。

**测试先行**：执行真实摄取，然后只手动删除多 chunk 文档的**一部分** points（registry 中的 `chunk_count` 仍然指向更高的数量，而 Qdrant 中的实际数量更低），断言下一次同步检测到不匹配并重新摄取，恢复完整的 chunk 数量。

### 4. “registry 全新、Qdrant 过期”的场景

通过追踪实际执行路径回答，而不是凭假设：`docker compose down -v`（`IndexSchemaMismatchError` 实际记录的唯一迁移修复路径）会同时清除 `qdrant_storage` 和 `registry_data`——已通过 `docker-compose.yml` 确认，两者都是顶层 `volumes:` 下的命名 volume。因此，“registry 被清除而 Qdrant 未动”的场景只会来自非标准的运维操作（手动删除 registry 文件，或只重置 `registry_data` volume），而不是文档记录的路径。

如果确实发生这种情况：全新、空的 registry 没有任何行，因此下一次同步中 `registry.has_changed(...)` 会对每个文档返回 `True`（没有现存记录可比较），所有文档都会进入完整重新摄取路径，不受第 1–3 项对账逻辑影响，因为那些逻辑只会在*未变化*分支触发。这会自我修复 Sprint 17 point-ID 冲突缺口（任何此前冲突的两个文档都会在强制重新摄取时获得各自独立的新格式 point ID）。**一个已披露但此处不修复的残余边界情况**：对于内容不受冲突影响的文档（即它不是冲突中“丢失”的一方，旧 points 仍然真实有效），强制重新摄取时的 `delete_stale_versions(keep_version=content_hash)` 清理不会删除旧格式 points，因为它们的 `document_version` 已经等于新的内容哈希（内容没有变化）；因此，新 upsert 的 points 和仍存活的旧格式 points 会共存，形成无害重复（相同文本、两个 point ID），而不是被干净去重。这是数据质量问题（该文档可能出现重复搜索结果），不是正确性或数据丢失问题；这里将它明确披露，而不是让它无文档记录——符合本项目明确写出真实且已测量的权衡、不加掩饰的既有模式（例如 Sprint 13 的重复可见窗口）。该边界情况只影响非标准的部分清除操作，本 sprint 不单独修复。

### 5. 降级测试

新增测试：显式存储 `CURRENT_INDEX_SCHEMA_VERSION + 1` 的 registry（模拟“该 registry 由更新版本代码构建，然后运行中的应用发生降级”）——断言 `ensure_index_schema_version()` 抛出 `IndexSchemaMismatchError`。根据背景部分，现有逻辑应该已经正确处理（没有对“stored > current”做特殊处理，两个方向都会进入相同的抛出分支）；该测试用于证明这一点，而不是把它作为未经验证的假设留下。

### 6. 损坏的元数据值

`get_index_schema_version()`：将 `int(row[0])` 的转换包在 try/except 中；当存储值不是有效整数时，抛出 `IndexSchemaMismatchError`（而不是原始 `ValueError`）——这与代码库中其他 schema-mismatch 路径遵循的“清晰告知人工处理”契约一致。测试：直接向 `registry_metadata` 中 `index_schema_version` 对应位置写入非数字字符串，断言 `ensure_index_schema_version()` 抛出 `IndexSchemaMismatchError`（而不是 `ValueError`）。

### 7. README 修复

第 7 行：“...cross-encoder reranking, grounded generation with citations, OpenTelemetry tracing)...” → “...cross-encoder reranking, citation-aware generation, OpenTelemetry tracing)...”——修复最后一处残留的 “grounded” 措辞，与 Sprint 17 和 Sprint 17.1 中已经修正的其他 citation 相关标题/描述保持一致。

## 沿用的规则

- 全程测试先行；第 2 项的核心测试必须是审查指出的确切场景（真实摄取、只在 Qdrant 中手动删除、证明下一次同步自动重建索引），不能用合成替代方案。
- commit 中不得加入 AI co-author 行。
- 收尾记录必须说明对账机制的工作方式，以及性能成本是如何测量或推理得出的。

## 完成定义

在 registry 未触碰、哈希不变的情况下手动从 Qdrant 删除文档后，下一次同步会自动重建索引，并通过真实场景测试证明；检测到降级（存储版本高于当前版本）并快速失败；损坏的（非数字）schema-version 元数据产生 `IndexSchemaMismatchError`，而不是原始 `ValueError`；README 中最后一处 “grounded” 措辞已修复；测试与 lint 均干净。

这是最后一个 sprint——本 sprint 完成后项目冻结。
