# Sprint 17 — 身份与取消安全

## 背景（规划前请阅读，不要想当然）

Sprint 16 的收尾记录报告了 380 个测试通过、`ruff` 检查干净，并修复了多批次重索引回滚 bug。对该工作的第三次外部评审发现了一个更严重的既有 bug，也正是这项工作暴露出的 bug：`point_id_for` 的身份键存在问题。

以下内容均已直接对照代码确认：

- `QdrantStore.point_id_for`（`app/ingestion/qdrant_store.py`）用 `f"{chunk.source_type}:{chunk.doc_id}:{chunk.page_number}:" f"{chunk.paragraph_index}:{chunk.char_range[0]}:{chunk.char_range[1]}"` 构造 UUID5 键——**`source_id` 不在键中。** `doc_id` 是内容 hash（`app/ingestion/chunker.py::compute_doc_id`），因此两个内容字节完全相同但文件名/source_id 不同的文档（例如复制成 `contract-a.pdf` 和 `contract-b.pdf` 的 PDF，或恰好文本相同的两个 Notion 页面）会为对应分块产生完全相同的 `(doc_id, page_number, paragraph_index, char_range)` 元组，从而得到相同的点 ID。第二个文档的 `upsert_chunks` 调用会在 Qdrant 中静默覆盖第一个文档的点——不是错误，也不是重复，而是没有任何痕迹的数据丢失。
- **测试套件本身掩盖了这个 bug**，通过仔细阅读 `tests/test_qdrant_store.py::test_delete_by_source_does_not_touch_other_documents` 已确认：它调用 `_chunk(source_id="doc1")` 和 `_chunk(source_id="doc2")`，但 `_chunk` 的默认 `doc_id="doc1"` 在两次调用中都没有被覆盖——所以两个分块在测试自己的 `delete_by_source` 调用之前就已经发生了点 ID 冲突。`store.upsert_chunks([...])` 静默地只写入一个点（第二次调用覆盖了第一次），因此删除后的 `assert store.count() == 1` 只是因为错误原因通过——它从未真正证明两个独立文档的点能独立存活，因为实际从来只有一个点。这个 sprint 的核心教训是：一个绿色测试可以掩盖它本来要捕获的 bug；修复不能完成于“测试通过”，还必须确认新测试围绕真实修复先失败再变绿，而不是围绕测试辅助函数的巧合。
- `app/ingestion/ingest.py` 的 Sprint 16 回滚块是 `except Exception:`（约第 275 行）——在 Python 3.8+ 中，`asyncio.CancelledError` 直接继承自 `BaseException`，不是 `Exception`，因此同步过程中发生取消会绕过整个回滚，直接向外传播，并永久留下此前已经写入的部分新版本（Sprint 16 为普通异常修复的故障模式因取消而重新出现）。这是真实路径，不是理论情况：`app/sync/scheduler.py` 和任何 ASGI 服务器的优雅关停都可能对正在执行的同步协程调用 `task.cancel()`。`app/sync/manager.py::trigger_sync` 自己的 `except Exception as exc:` 也有同样缺口——被取消的同步运行的 `finally:` 仍会正确地将 `self._running[source_type] = False`，但由于 `CancelledError` 不会进入 `except` 或 `else` 分支，其 `sync_runs` 行会永久保持 `STATUS_RUNNING`（在同步状态 UI 中无法与进程中途崩溃且没有记录原因区分）。
- `slugify()`（`app/shared/slug.py`）将所有非单词字符替换为 `_`——已确认其正则表达式为 `r"[^\w\-]"` → `_`。两个不同的真实文件名，例如 `"foo bar.md"` 和 `"foo_bar.md"`，会 slugify 成相同的 `source_id`（去掉扩展名后都是 `"foo_bar"`，或者保留扩展名时都是 `"foo_bar.md"` / `"foo_bar_md"` 形状）。`ingest_connector` 从不检查这一点——两个 connector 文档如果共享 `source_id`，其注册表行和 Qdrant 点就会不确定地交错，取决于迭代顺序。这是与点 ID 问题同一类“静默身份冲突”的第二种形式，应在同一个 sprint 中关闭。
- `ensure_collection()`（Sprint 16 之后）在确认 `SPARSE_VECTOR_NAME in (info.config.params.sparse_vectors or {})` 后，直接执行 `info.config.params.vectors[VECTOR_NAME]`——但它没有先检查 `VECTOR_NAME` 是否存在。一个确实可能发生的错误配置是：集合有某种稀疏配置（无论名称是什么），却根本没有名为 `"dense"` 的向量；此时会抛出原始 `KeyError`，而不是该函数契约所要求的 `UnexpectedCollectionSchemaError`。另外，稀疏检查只验证键存在，从不验证 `sparse_vectors[SPARSE_VECTOR_NAME].modifier == qmodels.Modifier.IDF`——而 `create_collection` 总是明确设置 IDF，这意味着创建和验证两条代码路径对“正确 schema”的理解并不一致。
- `QdrantStore.upsert_chunks` 在没有任何长度检查的情况下对 `chunks`、`dense_vectors` 和 `sparse_vectors` 使用 `zip`——`zip()` 会静默截断到最短输入。一个产生长度不匹配列表的调用方 bug（未来批处理改动中的 off-by-one、未在其他地方捕获的部分嵌入结果）会在分块数量不足时静默写入更少的点，而且没有任何 chunk-count/point-count 断言在进入生产数据前捕获它。
- README：`## Known Limitations` 的重索引项目仍写着“本地测量约 12 微秒”——Sprint 16 已经在 `### Re-indexing a changed document` 一节中用真实多批次数字（约 1.5–3ms，从第一次 upsert_batch 测量）更新了正文，却遗漏了 Known Limitations 中这处重复内容，使同一文档内出现两个矛盾数字。另外，`## Highlights` 有一个标题为 **“Grounded, multi-source citations”** 的项目——这里的 “Grounded” 读起来是在声称语义 grounding（验证某个断言确实由引用文本支持），而 `app/llm/grounding.py` 自己的 docstring 明确否认了这一点（“不是语义 grounding……只能说明引用本身指向真实内容”），并且其后的 `### Citation integrity validation, not semantic grounding` 章节也直接与 Highlights 标题的表述矛盾。

## 范围（按优先级排序）

### 1. 点 ID 冲突（最关键）

**修复**：将 `source_id` 加入 `point_id_for` 的键——`f"{chunk.source_type}:{chunk.source_id}:{chunk.doc_id}:{chunk.page_number}:" f"{chunk.paragraph_index}:{chunk.char_range[0]}:{chunk.char_range[1]}"`。`source_id` 放在 `source_type` 之后（两者都是稳定的身份字段；`doc_id` 是编辑时会变化的内容 hash，因此仍与描述“某个特定文档某个特定版本中的位置”的位置字段放在一起）。

**测试先行，且顺序必须真正捕获 bug**：
1. 在 `tests/test_qdrant_store.py` 中新增单元测试，断言两个具有相同 `doc_id`/`page_number`/`paragraph_index`/`char_range`、但 `source_id` 不同的分块，`point_id_for` 产生不同 ID——在修复前先运行并确认失败（证明测试捕获的是真实 bug，而不是假问题）。
2. 修复 `test_delete_by_source_does_not_touch_other_documents` 本身：给两个 `_chunk(...)` 调用传入不同且明确的 `doc_id`（不要依赖默认值），这样“两个文档，删除一个，另一个保留”的故事才重新成立。但这不足以证明通用 bug 已修复，因为它只覆盖了一种特定的 doc_id/source_id 组合。
3. 新增场景测试：构造两个 `doc_id` 相同、page/paragraph/char_range 相同但 source_id 不同的分块，将它们一起 `upsert_chunks`。**在任何删除之前**断言 `store.count() == 2`（这是评审明确要求补上的断言——原来的 bug 正是缺少它才被测试掩盖）。然后按 source 删除一个，断言另一个仍然存在且文本属于它自己。
4. 真实 e2e 测试（评审建议的 bonus）：构造两个内容字节相同的文件 `a.md`/`b.md`，都通过 `LocalFilesystemConnector` + `ingest_connector` 送入真实的（`:memory:`）Qdrant 集合和真实 SQLite 注册表。断言两个文档都有独立的注册表行，并且 Qdrant 点彼此独立、不冲突（`store.count()` 反映两个文档的完整分块数量，而不是有一个被覆盖）——证明修复贯穿完整真实管道，而不只是 `point_id_for` 单元层级。

### 2. 取消导致回滚绕过

**修复**：在 `ingest_connector` 的 try/except（Sprint 16 的回滚块）中增加同级的 `except asyncio.CancelledError:`，执行完全相同的 `store.delete_version(...)` 回滚，然后重新抛出（只使用 `raise`，保留 `CancelledError`——绝不能吞掉取消，否则会破坏调用方真正停止任务的能力）。在 `app/sync/models.py` 增加 `STATUS_CANCELLED = "cancelled"`。`SyncManager.trigger_sync`：在现有 `except Exception as exc:` 旁增加 `except asyncio.CancelledError:` 分支，调用 `self._history.finish_run(run_id, status=STATUS_CANCELLED, error_message="Sync was cancelled")`，然后重新抛出——这样被取消运行的 `sync_runs` 行会显示“cancelled”，而不会因为没有记录而悄悄卡在“running”。

**测试先行**：使用一个真实的 `asyncio.Task` 包装 `ingest_connector`（或 `trigger_sync`），让 `embed_fn` 在检测到“第 1 批已写入、现在进入第 2 批”时发出信号（例如通过 `asyncio.Event` 或计数器检查），此时测试调用运行中任务的 `task.cancel()`——使用 asyncio 自己的真实取消投递，而不是手动抛出一个 `CancelledError` 代替。断言：(a) 等待被取消任务会抛出 `CancelledError`；(b) 回滚确实执行——新 `document_version` 下没有存留点，旧版本保持完整；(c) 对 `SyncManager` 层级的测试，`sync_runs` 显示该运行的 `status="cancelled"`，而不是卡在 `"running"`。

### 3. 重复 source_id 快速失败保护

**修复**：在 `ingest_connector` 顶部、紧接 `current_documents = await connector.list_documents()` 之后，检查这些文档中是否存在重复 `source_id`（例如从删除阶段已经构建的同一个集合计算：`len(seen_source_ids) != len(current_documents)`），并抛出新的 `DuplicateSourceIdError`（在 `app/ingestion/ingest.py` 中，与 `IngestStats` 并列定义），在本次同步运行执行任何注册表/Qdrant 工作之前，列出冲突的 `source_id`——快速失败，不造成部分损坏。这是有意放在 connector 输出边界上的检查，而不是修复 `slugify()`：slugify 冲突是一种真实原因，但并不是唯一原因；在 `ingest_connector` 边界检查可以统一捕获所有情况。

**测试先行**：让一个假的 `Connector.list_documents()` 返回两个具有相同 `source_id` 的 `ConnectorDocument`，断言 `ingest_connector` 抛出 `DuplicateSourceIdError`，并且在未触碰注册表或 store 的情况下失败（通过 spy/counter 验证：没有任何 `registry.upsert_document` 或 `store.upsert_chunks` 调用）。

### 4. 完整的 Qdrant schema 校验

**修复，分两部分**：
- 在访问 `info.config.params.vectors[VECTOR_NAME]` 之前，检查 `VECTOR_NAME in (info.config.params.vectors or {})`；如果不存在，抛出 `UnexpectedCollectionSchemaError`（而不是原始 `KeyError`），错误消息中说明缺少什么。
- 确认 `SPARSE_VECTOR_NAME` 存在后，再检查 `info.config.params.sparse_vectors[SPARSE_VECTOR_NAME].modifier == qmodels.Modifier.IDF`；如果不匹配，同样抛出该错误类型。

**测试先行**：创建一个稠密向量使用其他名称（不是 `"dense"`）且带正确命名稀疏向量的集合，断言 `ensure_collection()` 抛出 `UnexpectedCollectionSchemaError`（而不是 `KeyError`）。再创建一个稠密和稀疏向量名称都正确、但稀疏 modifier 非 IDF（或没有 modifier）的集合，断言同样的错误。

### 5. `upsert_chunks` 长度保护

**修复**：在 `upsert_chunks` 顶部断言 `len(chunks) == len(dense_vectors) == len(sparse_vectors)`；如果不匹配，抛出 `ValueError`，消息中包含三个长度，且不写入任何内容。

**测试先行**：使用长度不匹配的列表调用 `upsert_chunks`（例如 2 个 chunks、1 个 dense vector），断言抛出 `ValueError`，并且之后 `store.count()` 仍为 0（没有发生部分写入）。

### 6. README 修复

- `## Known Limitations` 的重索引项目：将“本地测量约 12 微秒”替换成 Sprint 16 已在 `### Re-indexing a changed document` 中使用的相同真实数字（真实多批次文档约 1.5–3ms，从第一次 upsert 测量），使文档不再自相矛盾。
- `## Highlights`：将 **“Grounded, multi-source citations”** 改名为 **“Source-scoped citation validation”**（或其他不暗示语义 grounding 的等效表述），保留项目正文已有内容（跨来源伪造证明的描述）；正文已经正确描述了引用*完整性*，只是标题中的词语夸大了含义。

## 延续规则

- 测试先行，尤其是第 1、2 项——并且每个新测试都要在修复前确认确实失败（而不是只确认修复后通过），从而验证测试本身有效，而不是想当然。本 sprint 的整个前提就是：一个通过的测试可能掩盖真实 bug。
- 提交中不得加入 AI co-author 行。
- 收尾记录必须包含：点 ID 冲突的真实、具体影响（通过复现测试确认数据丢失是什么样的），以及取消测试如何投递真实的 `task.cancel()`，而不是替代方案的描述。

## 完成定义

内容相同但来源不同的两个文档不再冲突（通过在任何删除之前断言点数量的真实测试证明）；同步过程中发生取消时会正确回滚并记录 `status="cancelled"`，不会留下卡在 “running” 的运行；重复 source_id 会在触碰注册表/store 前快速失败；Qdrant schema 校验会抛出自己的错误类型（不是 `KeyError`），并检查稀疏 modifier；`upsert_chunks` 会拒绝输入长度不匹配；README 中两个重索引窗口数字一致，Highlights 标题不再过度宣称；测试和 lint 均干净。
