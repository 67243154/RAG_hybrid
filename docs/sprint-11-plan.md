# Sprint 11 计划 — Docker Compose 收尾

## 目标

`docker compose up` 启动 Qdrant、Jaeger 和新的后端；Ollama 保持原生运行；registry/sync-history 的 SQLite 文件在容器重启后保留。

## Ollama 保持原生

参考项目因 Docker Desktop 无 GPU 直通而让容器化 Ollama 退回慢速 CPU 推理。本项目沿用该约束，默认 `OLLAMA_BASE_URL=http://host.docker.internal:11434`，并在本 sprint 通过真实容器验证该地址。

## Dockerfile 与依赖

`sentence-transformers` 会传递安装 `torch`，在 manylinux 上可能选择约 2GB 的 CUDA 包；容器不使用 GPU，因此先从 PyTorch CPU index 安装 CPU-only torch，再安装 `requirements.txt`。基础镜像为 `python:3.12-slim`，安装 `curl` 健康检查，复制 `app/` 和 `prompts/`，入口为 `uvicorn app.server:app`。

## 健康检查

新增 `GET /health`（存活检查）和 `GET /health/ollama`（复用 `OllamaClient.list_models()` 的真实连接检查并返回模型列表），用于验证容器能解析 `host.docker.internal`。

## 持久化

`DocumentRegistry` 与 `SyncHistory` 共享 `registry_db_path`（默认 `data/registry.db`），使用命名卷 `registry_data:/app/data`。用户投放文件的 `data/documents/` 使用 bind mount `./data/documents:/app/documents`，后端设置 `FILESYSTEM_ROOT_PATH=documents`。模型缓存使用命名卷 `hf_cache:/root/.cache/huggingface`，避免每次启动重新下载。

## 同步调度器

`create_app()` 新增可选 `scheduler: SyncScheduler | None = None`。通过 FastAPI lifespan，在启动时调用 `scheduler.start()`，关闭时 `await scheduler.stop()`；默认 `None` 保持现有测试行为。`app/wiring.py::build_app()` 根据 `sync_intervals_from_settings(settings)` 构造并传入调度器。

## README 与范围

README 增加 Mermaid 架构图和原生 Ollama、可选 `NOTION_API_KEY` 的设置说明。`make ingest`、`app.evaluation.cli` 和 Streamlit UI 不放入容器，它们是宿主机按需执行的工具。

## 验证计划

1. 执行 `docker compose down -v` 后 `docker compose up -d --build`，确认 `/health`、`/health/ollama` 返回 200 和真实模型列表，调用 `POST /sync/filesystem` 及 `/chat` 完成端到端验证。
2. 已产生同步历史后执行 `docker compose restart backend`，确认 `GET /sync/filesystem/history` 仍返回重启前记录，以证明命名卷确实持久化。
