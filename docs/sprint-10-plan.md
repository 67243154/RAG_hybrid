# Sprint 10 计划 — UI（多页面 Streamlit）

## 目标

通过 `st.navigation` 提供三个页面：聊天（流式输出、引用和流水线追踪）、来源（连接器列表、文档数量、手动同步）和同步状态（运行历史、按来源统计及 Jaeger 链接）。

## 独立 UI 虚拟环境

项目实际验证了 `fastapi==0.115.6` 与 `streamlit==1.61.1` 的 `starlette` 依赖冲突，因此使用独立的 `.venv-ui` 和 `requirements-ui.txt`。UI 只需 `streamlit`、`httpx` 和用于追踪柱状图的 `pandas`，不直接安装 `qdrant-client`、`pymupdf`、`fastembed`、`sentence-transformers` 或 `deepeval`。

## 全部通过 HTTP

Sources 页面调用已有的 `POST /sync/{source_type}`，并新增 `GET /sources` 获取连接器和文档数量。UI 不直接访问 Qdrant、registry 或 ingestion，也不包含文件上传；文件系统连接器扫描固定的 `filesystem_root_path`。

## 真实后端 wiring

`app/wiring.py::build_connectors(settings)` / `build_app(settings)` 构造真实 `OllamaClient`、`QdrantStore`、`DocumentRegistry`、`SyncHistory`、`SparseEncoder`、连接器字典和 `SyncManager`，再调用 `create_app(manager, history, registry)`。`app/server.py` 暴露 `app = build_app(settings)`，供 `uvicorn app.server:app` 使用；`Makefile` 增加 `dev` 目标。新增 `filesystem_root_path: str = "data/documents"`，并用 `data/documents/.gitkeep` 保留目录。

本 sprint 不启动 Sprint 7 的周期同步器；周期任务留给 Sprint 11 的 ASGI lifespan。

## 接口

- `POST /chat`：复用现有 provider 抽象（`get_chat_provider(settings)`、`get_embedding_provider(settings)`、`default_chat_model(settings)`、`default_embed_model(settings)`），并保持 `chat_request`/`load_models` span 名称。
- `GET /sources`：返回 `[{
  "source_type": str, "document_count": int, "is_running": bool
}]`，由 `SyncManager.known_source_types`、registry 计数和运行状态组成。

## 页面与客户端

`app/ui/sse_client.py`、`app/ui/trace_client.py` 保持协议级实现，`app/ui/citation_formatting.py` 使用多来源引用格式 `[s.source_type:source_id/location]`。`app/ui/sources_client.py` 提供 `fetch_sources()`、`trigger_sync(source_type)` 和 `fetch_sync_history(source_type)`。来源页面显示连接器、文档数、运行状态和“立即同步”；同步状态页面显示每个连接器的历史及 `{JAEGER_URL}/trace/{trace_id}`。

## 测试与浏览器验证

单元测试覆盖 SSE、Jaeger 重试、sources client、`GET /sources` 和 `POST /chat`。真实验证步骤：启动 Qdrant、Jaeger、原生 Ollama、`app.server:app` 和 Streamlit；向 `data/documents/` 放入 Markdown，点击 filesystem 同步，确认文档数和同步历史更新；在聊天中提问，确认流式输出、引用、grounding 标记和流水线追踪与 Jaeger API 一致。
