# Sprint 17.1 — 迁移安全与测试假阳性清理

## 背景（规划前阅读，不得凭假设）

Sprint 17 的收尾记录报告了 386 个测试通过、`ruff` 检查干净，并修复了一个真实的 point-ID 冲突缺陷（`QdrantStore.point_id_for` 现在会包含 `source_id`）。第四次外部审查发现：这个修复对于*新建*索引是正确的，但对已经按照旧公式发生冲突的数据不起作用。

已直接通过代码确认：

- **迁移缺口是真实存在的，不是理论问题。** 两个在 Sprint 17 之前的 point-ID 公式下发生冲突的文档（例如内容相同的 `contract-a.pdf`/`contract-b.pdf` 重复文件）中，一个文档的 Qdrant points 曾被另一个文档静默覆盖；但它们的 `content_hash` 不受 point-ID 公式变化影响（哈希由文件字节计算，位置是 `app/connectors/filesystem.py::get_content_hash`，与 `point_id_for` 完全无关）。因此，`ingest_connector` 的增量同步逻辑（`registry.has_changed(source_type, source_id, content_hash)`）在之后的每次同步中仍会把这些文档报告为“未变化”并跳过——新的 point-ID 公式只有在文档下次发生真正内容编辑时才会执行，而这次编辑可能永远不会发生。从 Sprint 16/17 之前直接升级到 Sprint 17+ 的部署，会永久保留已经损坏的索引（某个文档的 points 静默缺失），除非有操作强制进行全量重建索引。
- `app/registry/store.py` 完全没有版本化/元数据机制——完整读取其 schema 已确认（`documents` 表单独存在，没有 `schema_version` 或元数据表），因此当前应用无法知道“这个 registry/index 是在 point-ID 公式改变之前还是之后构建的”。
- Sprint 16 的两个测试 `test_ensure_collection_fails_fast_on_wrong_dense_vector_size` 和 `test_ensure_collection_fails_fast_on_wrong_distance_metric`（`tests/test_qdrant_store.py`）在 fixture 的 sparse 配置中使用了 `qmodels.SparseVectorParams()`——没有 `modifier` 参数。通过对真实的 `:memory:` Qdrant client 直接复现确认：未指定 sparse modifier 时，Qdrant 自身的默认值是 `None`，不是 `IDF`。由于 Sprint 17 在 `ensure_collection()` 中增加的 sparse-modifier 检查先于 dense-schema 检查执行，这两个测试现在都会因为 sparse-modifier 原因抛出 `UnexpectedCollectionSchemaError`（“modifier=None”）。直接复现得到的实际异常信息是 `"...sparse vector has modifier=None — this app requires modifier=IDF..."`，完全没有提到 size 或 distance。这两个测试的 `match=COLLECTION` 断言只检查集合名称出现（该名称会出现在此函数可能抛出的每一种错误中），所以两个测试实际上都没有覆盖它们声称覆盖的 dense-size 或 dense-distance 分支。这正是 Sprint 17 本身要解决的“绿色测试掩盖真实缺陷”问题——现在在 Sprint 17 自己新增的测试中又发现了同样的问题。
- `ensure_collection()` 的 dense-vector 检查先执行 `dense_vectors = info.config.params.vectors or {}`，然后检查 `VECTOR_NAME not in dense_vectors`。直接复现确认：Qdrant 支持创建单个*未命名*的 vector（直接传入 `vectors_config=qmodels.VectorParams(...)`，而不是包装在 `{name: ...}` 字典中）；此时 `info.config.params.vectors` 是一个 `VectorParams` **对象**，而不是字典。如今对 `vectors_instance` 执行 `"dense" in vectors_instance` 没有抛出 `TypeError`，只是因为 Pydantic `BaseModel` 支持 `__iter__`（产生 `(field_name, value)` 对，这也是 `.dict()` 风格迭代所依赖的机制）。Python 的 `in` 运算符在没有 `__contains__` 时会回退到该迭代器协议，把 `"dense"` 与每个 `(field_name, value)` 元组比较，结果总是 `False`。因此代码碰巧进入了“缺少 dense vector”分支并抛出预期的 `UnexpectedCollectionSchemaError`——但这只是偶然，依赖的是未在代码注释或测试中声明、解释过的 Pydantic 迭代细节。未来的 Pydantic/qdrant-client 版本可以在不发出警告的情况下改变 `BaseModel.__iter__` 行为（或删除它），届时这里会静默变成真实的 `TypeError` 崩溃，而不是预期的清晰错误。显式增加 `isinstance(dense_vectors, dict)` 检查可以去掉这种偶然依赖，并明确真正的意图。
- `app/ingestion/ingest.py` 中 Sprint 17 新增的 `except asyncio.CancelledError:` 回滚块调用 `store.delete_version(...)` 时没有自身的错误处理。如果这次调用本身抛出异常（这是现实可能发生的：Qdrant 在关闭中途不可达，或者触发取消的同一关闭流程已经先拆除了连接），该异常在 `except` 块中从裸 `raise` 处继续向外传播，并且关键的是，会取代原始的 `CancelledError`，成为调用方实际看到的异常（原始异常会变成 `__context__`，但处于次要位置）。如果调用方通过 `isinstance(exc, asyncio.CancelledError)` 专门确认任务确实响应了取消，看到的就会是错误的异常类型。`app/sync/manager.py` 中对应的 `except asyncio.CancelledError:` 分支与 `self._history.finish_run(...)` 也有完全相同的结构。
- README：`## Status` 写着“Sprints 0–16 complete”（Sprint 17 已经发布），其第一条 bullet 还写着“reranking, grounded citations)”——这与 Sprint 17 已将 `## Highlights` 中对应 bullet 改为“Source-scoped citation validation”不一致，后者专门避免了 `grounding.py` 自身 docstring 否认的语义 grounding 含义。另外，`DuplicateSourceIdError` 的 docstring（`app/ingestion/ingest.py`）及其测试的 docstring（`tests/test_ingest_connector.py`）都说重复检查发生在“任何 registry/Qdrant 工作之前”/“没有任何内容被触碰”——但 `ingest_connector` 在重复 source_id 检查（约第 198–203 行）之前调用了 `store.ensure_collection()`（第 188 行）。在真正全新的 Qdrant 实例上，`ensure_collection()` 会在重复检查触发前创建 collection（只有 schema，没有 points），因此“什么都没改动”的表述过度了。测试本身的断言已经很准确（`store.count() == 0` 和 `registry.list_documents(...) == []`——二者正确检查的是零*文档数据*，而不是零*schema 对象*），不准确的只是文字描述。

## 范围（按优先级排列）

### 1. Point-ID schema 迁移检测（最关键）

**决定：启动时快速失败，而不是自动重建索引。** 之前有两个方案可选；选择快速失败，理由与本项目已有的风险策略一致：

- 应用启动时自动进行全量重建索引，需要在应用甚至开始提供 `/health` 服务之前，对每个 connector 发起真实、可能缓慢、也可能失败的网络调用（尤其是 Notion）。这是把一个正确性关键操作隐藏在普通启动流程中的做法，与 `QdrantStore.ensure_collection()` 已明确拒绝对 schema 不匹配执行的隐式、近似不可逆操作属于同一类（参见 `UnexpectedCollectionSchemaError` 的 docstring：“this collection was left untouched... delete it yourself if that's genuinely safe”）。迁移也应采取相同策略：不要猜测，要明确告知人工处理。
- Docker Compose 的全新安装流程（`docker compose down -v` + `up`）已经存在且已有文档记录（Sprint 11 的真实全新安装验证）——复用它来执行 schema 迁移，是一个已知且已经测试过的运维动作，而不是要求运维人员学习的新概念。
- 快速失败很容易测试（纯函数/方法调用即可）；而自动重建索引的正确性需要针对一次性、低频事件编写更重的集成测试（真实 connector、真实网络 mock）。

**机制**：在 `DocumentRegistry` 现有的 SQLite db 中新增 `registry_metadata` 表（`key TEXT PRIMARY KEY, value TEXT NOT NULL`），用于存储 `index_schema_version`。在 `app/registry/store.py` 中增加 `CURRENT_INDEX_SCHEMA_VERSION = 2`（常量，并添加注释：版本 2 = Sprint 17 纳入 `source_id` 的 point-ID 公式；版本 1 隐含表示“此前所有版本，包括完全没有 version 行的 registry”）。新增 `DocumentRegistry.ensure_index_schema_version()`：

- 如果存储的版本等于 `CURRENT_INDEX_SCHEMA_VERSION`：无操作，返回。
- 如果没有存储版本且 registry 中没有文档行（`list_documents()` 为空）：这是确实全新的安装，没有需要迁移的内容——写入 `CURRENT_INDEX_SCHEMA_VERSION` 后返回。自修复行为：运维人员执行 `docker compose down -v` + `up` 后，下一次启动时 registry 为空，因此该分支会自动执行并写入版本，不需要除清除操作之外的额外步骤。
- 其他情况（没有存储版本但存在文档——一个早于该跟踪机制、因而也早于 Sprint 17 point-ID 修复的 registry；或者显式存储的版本低于当前版本）：抛出 `IndexSchemaMismatchError`，错误信息列出存储版本与要求版本，并给出准确的修复命令（`docker compose down -v && docker compose up`）。

在 `DocumentRegistry(...)` 构造完成后、任何 connector 或同步 wiring 之前，于 `app/wiring.py::build_app()` 中尽早调用一次——这样在应用开始对已知损坏的索引提供流量之前就会停止启动，符合“拒绝启动”的语义。

**测试先行**（`tests/test_document_registry.py`，新增测试）：

1. 一个没有文档的全新 `DocumentRegistry`：`ensure_index_schema_version()` 不抛异常，之后 `get_index_schema_version() == CURRENT_INDEX_SCHEMA_VERSION`（自动写入版本）。
2. 一个直接调用过 `upsert_document(...)` 的 `DocumentRegistry`（模拟有数据但从未写入版本行的 Sprint 17 之前真实 registry）：`ensure_index_schema_version()` 抛出 `IndexSchemaMismatchError`。
3. 一个显式写入过旧版本行的 `DocumentRegistry`（模拟未来某次该机制本身升到 3+ 后落后一个版本的 registry）：抛出 `IndexSchemaMismatchError`。
4. 对已经是当前版本的 registry 连续调用两次 `ensure_index_schema_version()`：无错误、无变化，证明其幂等性。

### 2. 修复 dense-schema 测试的假阳性

两个测试 `test_ensure_collection_fails_fast_on_wrong_dense_vector_size` 和 `test_ensure_collection_fails_fast_on_wrong_distance_metric` 中 fixture 的 `sparse_vectors_config={SPARSE_VECTOR_NAME: qmodels.SparseVectorParams()}` 增加 `modifier=qmodels.Modifier.IDF`，这样 sparse 检查会通过，实际触发的才是 dense 检查。每个测试的断言从通用的 `match=COLLECTION` 改成只能匹配目标分支的内容——size 测试使用 `match="size=384"`，distance 测试使用 `match="EUCLID"`——这样未来验证分支重排或类似的掩盖回归会立即被发现，而不是因为错误原因默默通过。

按照本 sprint 自己的规则：修复前，先通过临时为 fixture 增加 dense-specific 文本的 `match` 并运行*未修复*的测试，确认它当前确实失败（证明假阳性是真实存在，而非假设）；然后修复 fixture，并确认测试因正确原因通过。

### 3. 对未命名 vector collection 增加显式 `isinstance` 守卫

在 `ensure_collection()` 中，执行 `dense_vectors = info.config.params.vectors or {}` 后，在检查 `VECTOR_NAME not in dense_vectors` 之前增加 `if not isinstance(dense_vectors, dict): raise UnexpectedCollectionSchemaError(...)`——这明确表达了实际要求（必须是 NAMED dense vector，才能与同一 collection 中的 named sparse vector 共存），而不是依赖 Pydantic `BaseModel.__iter__` 偶然产生的 `in` 返回 `False` 行为。

测试：使用 `vectors_config=qmodels.VectorParams(...)`（未命名、单 vector）和正确的 sparse 配置（包含 `modifier=IDF`，避免像第 2 项的缺陷一样被 sparse 检查掩盖）创建真实的 `:memory:` collection——断言抛出 `UnexpectedCollectionSchemaError`，并且错误信息明确指出未命名 vector 问题（而不是旧的偶然“缺少 'dense' dense vector”措辞），证明修复确实改变了行为，而不是碰巧匹配修复前的错误信息。

### 4. 取消时回滚自身的失败不得掩盖 `CancelledError`

`ingest.py` 的 `except asyncio.CancelledError:` 块中的 `store.delete_version(...)` 调用，以及 `sync/manager.py` 对应块中的 `self._history.finish_run(...)` 调用，都要包在各自的内部 `try/except Exception:` 中；捕获后记录日志（每个模块新增 `logging.getLogger(__name__)`，并调用 `logger.exception(...)`），但不重新抛出内部失败——这样仍会到达外层的 `raise`，从而原样重新抛出原始的 `asyncio.CancelledError`。测试先行：构造 `ingest_connector`/`trigger_sync` 的取消场景（使用真正的 `task.cancel()`，模式与 Sprint 17 已有的取消测试相同），并 monkeypatch/子类化让回滚调用（`delete_version`/`finish_run`）抛出自身异常——断言等待被取消的任务时，调用方仍然看到 `asyncio.CancelledError`，而不是回滚异常的类型。

### 5. README 修复

- `## Status`：“Sprints 0–16 complete” → “Sprints 0–17 complete”（确认这个特定计数短语只出现一次；sprint 描述中“tüm geçen yerlerde”的要求也因此满足）。
- 同一 bullet：“reranking, grounded citations) ported from production-rag-platform” → “reranking, citation-aware generation) ported from production-rag-platform”——与 Highlights 中已经改过的“Source-scoped citation validation”一致，避免同一处语义 grounding 含义被遗漏。
- `app/ingestion/ingest.py` 的 `DuplicateSourceIdError` docstring，以及 `tests/test_ingest_connector.py` 中 `test_duplicate_source_ids_from_a_connector_fail_fast` 的 docstring：将“before any registry/Qdrant work happens”/“nothing touched”改为“before any document points or registry rows are written”（或等价表述）——准确说明实际保证（在全新的 Qdrant 实例上，`ensure_collection()` 仍可能先创建空的 collection schema；保证的是零*文档数据*被写入），这也正是测试自身断言检查的内容。

## 沿用的规则

- 全程测试先行。
- 第 2 项特别要求：在编辑 fixture 前真实复现假阳性（上文已通过针对 `:memory:` Qdrant 的直接复现确认）——要证明，不要只声称。
- commit 中不得加入 AI co-author 行。
- 收尾记录必须说明迁移策略的选择（快速失败，而不是自动重建索引）及其理由。

## 完成定义

带有文档行的过期/未跟踪 registry 能被检测到，并且 `build_app()` 会拒绝启动，同时给出清晰的修复信息（通过真实 registry 状态测试证明，而不只是阅读代码）；两个 dense-schema 测试因 dense 原因失败/通过，并且断言具体错误信息，而不只是错误类型；未命名 vector Qdrant collection 会通过显式检查产生清晰的 `UnexpectedCollectionSchemaError`，而不是 `TypeError`，不再依赖偶然的 Pydantic 迭代行为；取消时的回滚失败仍会向调用方暴露 `CancelledError`，而不是回滚自身的异常；README 中的 sprint 计数、citation 标题措辞和 duplicate-guard 文档准确；测试与 lint 均干净。

这是项目冻结前的最后一个 sprint——完成后不再新增功能，只收尾这轮加固工作。
