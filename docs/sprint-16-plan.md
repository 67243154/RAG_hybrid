# Sprint 16 — 重索引失败语义与加固

## 背景（规划前请阅读，不要想当然）

Sprint 15 的收尾记录报告了 365 个测试通过、`ruff` 检查干净，并发现且修复了一个关停处理缺口。但它没有触及 `ingest_connector` 的实际重索引循环。[ADR 0003](adr/0003-deferred-cleanup-versioned-reindex.md) 记录了 Sprint 13 的延迟清理顺序，以及实测约 12µs 的重复可见窗口——但将该 ADR 与 `app/ingestion/ingest.py`（第 268–294 行）重新对照后，会暴露出 ADR 未提及的真实缺口：“新版本全部完成嵌入并写入后再清理”的保证只在**单个批次内**成立。嵌入/写入循环按批次执行（`for batch_start in range(0, len(chunks), upsert_batch_size)`），但循环外没有 try/except。如果第 1 批嵌入和写入成功，而第 2 批嵌入抛出异常，那么第 1 批的分块已经以新的 `document_version` 提交到 Qdrant，异常从 `ingest_connector` 未处理地向外传播，`delete_stale_chunks` 永远不会运行。留下的内容是：旧版本的点（未被触碰，到目前为止没问题）**加上部分新版本**——新文档的分块只有一部分。Sprint 13 ADR 的核心声明（“嵌入中途失败……会使旧版本保持完整”）仍然成立，但并不完整：它没有披露此时还可能存在一个*部分的新版本*，使搜索结果中同时出现截断且不一致的新内容和仍然完整的旧内容。这正是外部评审指出的 bug，也是下面第 1 项要修复的问题。

以下其他事项均已直接对照代码确认（不是想当然）：
- `Settings`（`app/shared/config.py`）中任何地方都没有 Pydantic `Field` 约束——`embedding_concurrency: int = 4` 只是一个普通注解。`EMBEDDING_CONCURRENCY=0` 会静默通过构造，并且第一次调用 `embed_texts_concurrently` 时会让 `asyncio.Semaphore(0)` 死锁（通过阅读 `app/ingestion/ingest.py::embed_texts_concurrently` 已确认——对于非空批次，`Semaphore(0)` 永远不允许任何 `_bounded` 协程通过 `async with`，因此 `asyncio.gather` 永远不会完成）。
- `app/ui/pages/chat.py`（第 61–66 行）已经根据 `has_citations` 分支，但把所有无引用答案都当作中性的“ℹ️ No citations”情况——包括没有引用、却又**不是**模型诚实的 `NOT_FOUND_PHRASE`（“I could not find this in the document.”，`app/llm/prompt.py`）的答案；这实际上是一次静默幻觉（模型声称了某件事，却完全没有引用支持，比引用错误更糟）。
- `QdrantStore.ensure_collection()`（`app/ingestion/qdrant_store.py`）对于已存在的集合，只检查 `SPARSE_VECTOR_NAME in (info.config.params.sparse_vectors or {})`——从不检查 `info.config.params.vectors[VECTOR_NAME].size` 或 `.distance`。如果集合具有正确的稀疏配置，却有过时/错误的稠密维度（例如更换嵌入模型后仍复用旧的 `768` 维集合），`ensure_collection` 会静默通过，然后在第一次 `upsert` 时才失败。
- `app/main.py` 的 `lifespan` 已经执行 `for hook in on_shutdown or []: await hook()`，但没有 try/except——一个 hook 抛异常（例如 Notion 的 `aclose()` 在半开放连接上出错）就会中止循环，跳过之后才关闭的 Ollama/chat-provider 客户端。`app/wiring.py::build_app()` 的 `on_shutdown` 列表也从未包含 `qdrant_client` 本身——只有 `ollama.aclose`、`chat_provider.aclose` 和连接器的 `aclose`。`QdrantClient.close()` 是同步的，不是异步的（已通过已安装的 `qdrant_client` 签名确认），因此需要异步包装器以适配 hook 形状。
- README 的开头段落称通过共享的 `Connector` 接口“摄取多种文档类型（PDF、Markdown、网页、Notion、Confluence）”——对于五类中的两类，这种说法是错误的：`web_parser.py` 存在且已有测试（Sprint 6），但没有 `WebConnector`（README 的 Known Limitations 已正确披露），而 Confluence 从未开始实现（是 Sprint 16 的 stretch 项，不属于本 sprint）。另外，`## Status` 仍写着“Sprints 0–11 complete”，尽管 Sprints 12–15 已完成。
- `scripts/benchmarks/benchmark_embedding_concurrency.py` 当前的方法是：每个（chunk_count, concurrency）组合只运行一次、没有预热、并且始终以固定顺序 `[1, 2, 4, 8]` 测试并发级别（因此整个运行过程中的预热/缓存效应可能被误判为并发效应），完全不报告方差——README 的“在测量噪声范围内达到平台期”（Sprint 14 收尾记录）没有标准差数字支撑。
- `.github/workflows/ci.yml` 的 lint job 运行 `ruff check app tests`——从未对 `scripts/` 做 lint，这一点已通过检查 workflow 文件确认。

## 范围（按优先级排序）

### 1. 多批次部分新版本重索引 bug（关键）

**修复**：新增 `QdrantStore.delete_version(source_type, source_id, document_version)`——删除匹配指定版本的点（与删除除某一版本之外所有内容的 `delete_stale_versions` 互为镜像；此方法删除所有*匹配*某一版本的内容）。将 `ingest_connector` 的单文档嵌入/写入循环包裹在 try/except 中：一旦出现任何异常，调用 `store.delete_version(connector.source_type, document.source_id, content_hash)`，删除此前成功的任意批次中已经写入的部分新版本点，然后原样重新抛出原始异常（其他传播行为保持不变——Sprint 13 已经依赖“错误从 `ingest_connector` 逃逸”，本 sprint 不改变这一契约）。

回滚后，集合应精确恢复到该文档重索引尝试之前的状态：只有旧版本的点，新版本一个也没有——将 ADR 0003 对**整个文档**的保证恢复完整，而不再只对第一批有效。

**测试先行**（`tests/test_versioned_reindex.py`，新增测试）：一个文档被切成至少 6 个分块，`upsert_batch_size=2`（3 个批次），`embed_fn` 在第 1 批成功、在第 2 批抛异常。断言：(a) 旧版本的每个点仍然存在且文本保持原样；(b) 任何地方都没有携带新 `document_version` 的点（证明第 1 批的部分写入被回滚，而不是被留下）；(c) 注册表的 `content_hash` 仍是旧 hash（因此重试时仍会将该文档视为已变更）。

### 2. 诚实地重新测量重复可见窗口

现有测试 `test_duplicate_visibility_window_duration_is_measured_via_real_spans` 测量的是最后一个 `upsert_batch` span 结束到 `delete_stale_chunks` 开始之间的时间——它使用了适合单批次的文档，因此“最后一个 upsert_batch”和“第一个 upsert_batch”是同一个 span。对于真实的多批次情况，这是错误的数字：多批次重索引一旦第 1 批被写入，其新版本分块就会立即可搜索，与仍然完整的旧版本并存——并持续到最后一批完成后 `delete_stale_chunks` 才运行。真实窗口应从**第一个** `upsert_batch` span 结束测量到 `delete_stale_chunks` 开始，并且只有恰好一个批次时才等于旧数字。

**修复**：新增一个真实多批次文档测试（`upsert_batch_size` 足够小以强制产生至少 3 个批次），测量“第一个 upsert_batch 结束”→“`delete_stale_chunks` 开始”，像现有测试一样打印并断言 `>= 0`（不做严格上限约束——这是一个观测到的真实数字）。保留原来的单批次测试不变，并在旁边新增多批次测试，不要替换——两者都是真实场景，只是测量不同情况。README 的“约 12 微秒”声明要更新为新多批次测量得到的真实数字，并明确说明对于多批次文档，该窗口会随重索引时长扩大（批次越多，从第一次部分新版本写入到最终清理之间的时间越长），而不是无论文档大小都固定约 12µs。

### 3. 配置校验

为 `embedding_concurrency` 增加 `pydantic.Field(ge=1, le=32)`（32 是一个宽裕的上限——Sprint 14 的 benchmark 已显示 8 相比 4 没有可测量收益；32 只需要明显超过任何合理值即可），为 `filesystem_sync_interval_seconds` / `notion_sync_interval_seconds` 增加 `Field(gt=0)`（周期调度器的间隔为 0 或负数没有合理含义——`SyncScheduler` 的循环会忙等或行为异常）。Pydantic 会在 `Settings()` 构造时抛出 `ValidationError`，也就是进程启动时；目标是在死锁发生前尽早失败。测试：通过 `monkeypatch.setenv` 设置 `EMBEDDING_CONCURRENCY=0`，并围绕 `Settings()` 使用 `pytest.raises`，仿照 `tests/test_config.py` 中已有的 `test_generation_provider_rejects_unknown_value` 模式。

### 4. UI 中区分无引用答案

在 `app/ui/pages/chat.py` 的 `if not grounding_event["has_citations"]:` 分支中：检查 `full_answer.strip() == NOT_FOUND_PHRASE`（从 `app.llm.prompt` 导入）。如果匹配，保持今天中性的 `ℹ️ No relevant source found` 表达（合法的“未找到”答案不需要引用）。如果不匹配，则切换为 `⚠️ Answer contains no verifiable citations`——模型在没有任何引用支持的情况下作出了断言；根据 `grounding.py` 自己的 docstring，这正是“最危险的幻觉形态：完全没有引用标签，甚至无从质疑”。目前没有针对 Streamlit 页面测试的基础设施（已确认不存在 `tests/test_chat_page.py` 或类似文件），通过真实浏览器交互验证即可。

### 5. 完整的 Qdrant schema 校验

`ensure_collection()`：确认稀疏向量存在后，还要检查 `info.config.params.vectors[VECTOR_NAME].size == EMBEDDING_DIM` 以及 `.distance == qmodels.Distance.COSINE`；任一不匹配都抛出已有的 `UnexpectedCollectionSchemaError`（扩展错误消息），与稀疏配置检查保持同样的策略。测试先行，使用 `QdrantClient(":memory:")`：创建稀疏配置正确但稠密尺寸错误（例如 384 而非 768）的集合，断言 `ensure_collection()` 抛异常且不会删除集合；距离度量错误（例如 `EUCLID` 而不是 `COSINE`）同样测试。

### 6. 安全失败的关停

`app/main.py` 的 `lifespan`：将每个 `on_shutdown` hook 的调用分别包在 try/except 中，失败时记录日志但不抛出，这样一个损坏的 hook 不会阻止其余 hook 运行。测试先行（`tests/test_app_lifespan.py`，扩展 Sprint 15 的模式）：hook 列表为 `[raising_hook, tracking_hook]`，第一个抛异常；断言 `tracking_hook` 仍然运行。`app/wiring.py::build_app()`：通过一个小型异步包装器将 `qdrant_client` 加入 `on_shutdown` 列表（`QdrantClient.close()` 是同步的），这样四个真实的长生命周期客户端（Ollama embed、chat provider、Notion、Qdrant）都会在关停时关闭。

### 7. README 一致性修复

简介段落：改写为“通过共享的 `Connector` 接口处理 PDF、Markdown 和 Notion，另有尚未接入 connector 的独立网页解析器（`app/parsing/web_parser.py`）”——停止暗示 Confluence 已存在，也停止暗示网页解析器已经具备同步支持。`## Status`：将“Sprints 0–11 complete”改为“Sprints 0–15 complete”，并重新核对项目符号列表是否符合当前事实（tracing、evaluation、UI、Docker Compose、grounding 修复、CI、版本化重索引、嵌入并发、ADR/关停 hooks 都是真实存在的，因此 Status 项目符号只需修正数量和已变化的说法）。

### 8. 加固 benchmark 方法

`scripts/benchmarks/benchmark_embedding_concurrency.py`：在每个 chunk-count 的计时运行前增加一次不计时的预热调用（排除第一次请求的连接/模型加载开销）；每个（chunk_count, concurrency）组合运行 3 次并报告均值/中位数/标准差，而不是单个样本；对于每个 chunk-count-and-repeat，使用 `random.shuffle` 随机化并发级别的顺序（排除整个脚本运行过程中单调漂移被错误归因于并发）。这是一个**需要 Ollama 的手动脚本**（与 Sprint 14 一样——CI 没有 Ollama），本 sprint 如果原生 Ollama 可用就实际运行；如果无法访问，要在收尾记录中明确写出，README 表格保持等待重新运行的注记，而不是编造方差数字。

### 9. CI lint 范围

`.github/workflows/ci.yml`：将 `ruff check app tests` 改为 `ruff check app tests scripts`。提交 workflow 改动前先在本地运行 `ruff check scripts` 并修复其发现的问题，避免下一次 push 立即让 CI 变红。

## 延续规则

- 测试先行，尤其是第 1 项的回滚测试——这是本 sprint 唯一不能只靠读代码断言的部分。
- 提交中不得加入 AI co-author 行。
- 收尾记录必须包含：真实的新重复窗口测量值（一个数字，而不是“差不多”）、回滚行为的证明，以及 benchmark 的实际新结果（或者诚实说明“Ollama 无法访问，未重新运行”）。

## 完成定义

多批次部分失败场景已被证明能够回滚（通过测试验证，而不是只实现）；重复窗口已用真实多批次文档重新测量；配置校验会在启动时拒绝超范围值；UI 能区分无引用的 NOT_FOUND 与无引用且并非 NOT_FOUND 的答案：后者现在会警告；Qdrant schema 校验检查稠密维度和距离，而不只是稀疏向量是否存在；关停 hook 彼此隔离失败，且 `QdrantClient` 在其中；README 的 connector 说法和 Status sprint 数量准确；benchmark 方法包含重复、预热、随机化并报告方差；CI 也对 `scripts/` 做 lint；完整测试套件和 `ruff` 均干净。
