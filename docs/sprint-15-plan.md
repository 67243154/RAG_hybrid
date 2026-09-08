# Sprint 15 计划 — 文档与清理

## 目标

不增加功能，也不改变已测试路径的行为。将真正的多 sprint 设计叙事提取为 ADR，修复已确认的过期注释，补充 Known Limitations，并检查长生命周期客户端的 FastAPI 关闭处理。

## ADR 提取

扫描 `app/` 下全部 Python 文件后，短的 “Sprint N” 说明保留在调用点；以下四处多 sprint 叙事改为指向 ADR：`app/ingestion/ingest.py::ingest_connector`、`app/main.py::create_app`、`app/ui/trace_client.py::fetch_trace_spans` 和 `app/connectors/base.py::Connector`。新增六份 ADR：

1. `0001-connector-interface-is-async.md`（Sprint 3 → Sprint 6）
2. `0002-incremental-sync-three-phase-registry-diff.md`（Sprint 4）
3. `0003-deferred-cleanup-versioned-reindex.md`（Sprint 13）
4. `0004-single-trace-per-sync-run.md`（Sprint 8，Sprint 12 修复重试）
5. `0005-real-wiring-pulled-forward.md`（Sprint 7 → 10 → 11）
6. `0006-scheduler-wired-via-fastapi-lifespan.md`（Sprint 7 → 10 → 11）

调用点只保留行为、简短原因和 `docs/adr/000N-....md` 指针，完整历史移到 ADR。

## 过期注释与限制

修复 `tests/test_ingest_connector.py:151` 的旧注释：当前从 Sprint 4 起已跳过未变化文档。扫描 `app/` 与 `tests/` 后，其余类似“尚未/目前”注释仍与代码一致。

Known Limitations 增加：`SyncManager._running` 是进程内字典，单进程 Docker 当前没问题，未来多 worker/副本时不能跨进程防止同一连接器并发同步；Notion 连接器不递归嵌套子块，图片、表格、分隔线、嵌入等无可引用文本的块会丢弃；同时修正已过期的 Confluence Sprint 12 编号。

## 关闭处理

`create_app()` 的 lifespan 原先只停止 scheduler，没有关闭 `build_app()` 构造的长生命周期客户端：嵌入用 `OllamaClient`、聊天 provider（可能是另一实例或 `ClaudeProvider`）以及配置了 `NOTION_API_KEY` 时的 `NotionConnector`。为此增加可选 `on_shutdown: list[Callable[[], Awaitable[None]]]`，在 `scheduler.stop()` 后依次调用。`build_app()` 收集这些 hook；现有测试传入默认 `None`，行为不变。

使用与真实应用相同的组件进行 scratch 验证，确认 Ollama、Notion 和聊天 provider 的 `aclose()` 都能在没有处理请求时安全执行。
