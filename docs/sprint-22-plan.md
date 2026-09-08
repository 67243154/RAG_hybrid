# Sprint 22 计划 — Qwen3-4B@1024 生产嵌入迁移

## 决策来源

Sprint 21 以一项事先承诺、且有统计依据支持的
`PRODUCTION DECISION = ADOPT_QWEN3_4B_1024` 结束（见 `docs/PLANNING.md` 的
Sprint 21 收尾说明），但这只是建议，并未实际应用。`settings.ollama_embed_model`
仍为 `nomic-embed-text`。

## 范围

本 Sprint 只处理生产嵌入迁移。明确不在本 Sprint 范围内的内容包括：分块、稀疏编码、
RRF 融合、重排序器策略、生成模型、提示词系统、引用行为、文档来源，以及
Ollama→vLLM 后端迁移。

## 架构

通过 Qdrant 别名（`kb_active`、`app/migration/aliasing.py`）实现蓝绿部署。
Qdrant 对每个操作解析别名的方式与解析真实集合名完全相同，因此无需修改
`app/ingestion`/`app/retrieval`，只需修改 `app/wiring.py` 中物理集合名的解析方式。
迁移前 `kb_active` 不存在，所有调用点都会回退到字面值
`settings.qdrant_collection_name`，未迁移部署的行为不会发生变化。

物理集合命名为 `kb_<model>_<dimension>_<fingerprint-prefix>`
（`app/migration/naming.py`），由
`app/ingestion/fingerprint.py::PipelineFingerprint` 派生（本 Sprint 为其增加
`embedding_backend` 字段）。

## 新模块：`app/migration/`

- `models.py` — `MigrationManifest`、8 状态的 `MigrationStatus` 枚举
  （PLANNED/INDEXING/VALIDATING/READY_TO_SWITCH/SWITCHING/ACTIVE/
  ROLLED_BACK/FAILED）。使用普通类型化 dataclass + 枚举，不引入工作流引擎。
- `naming.py` — 确定性的集合命名。
- `aliasing.py` — 原子别名切换（`update_collection_aliases` 将删除和创建
  合并到一次调用中），并在解析别名时提供旧版回退。
- `embedding_migration.py` — 迁移引擎：`plan_migration`、`run_indexing`、
  `validate_structural`、`activate`、`rollback`、`get_status`、
  `cleanup_old_collection`。
- `quality_gate.py` — 复用 Sprint 18-21 的排序指标基础设施，针对冻结的 220
  个问题黄金集执行激活前质量门禁，并通过小规模分层 smoke check 完成切换后验证。
- `readiness.py`、`startup_guard.py` — 简单的 `/health/ready` 语义，以及启动时
  快速失败的维度不匹配保护。

## 用于索引的隔离注册表（关键设计决策）

索引完全复用未修改的 `app/ingestion/ingest.py::ingest_connector`，但针对每个
`migration_id` 使用隔离的 SQLite 注册表文件，而不是生产环境的 `registry.db`。
如果使用生产注册表，未经验证且尚未激活的目标集合可能在生产仍服务旧集合时，
悄悄改写生产环境的 `pipeline_fingerprint` 跟踪信息。隔离注册表初始为空，因此
第一次索引时每个文档都会被视为“新文档”（正确执行完整重新嵌入），再次运行时
则会识别为“已存在且指纹匹配”——这利用了 `ingest_connector` 现有增量同步语义
实现真正的幂等和续作，而不是引入新机制。

## 规则

- 旧集合绝不会自动删除；只有单独且明确的 `cleanup-old` CLI 命令可以执行删除，
  并且如果该集合仍是活动集合，命令会拒绝执行。
- 激活会执行切换后的 smoke check；如果失败，会在 `activate` 抛出异常前自动回滚别名。
- `rollback` 是对称的：连续运行两次会重新激活刚刚回滚的集合，且绝不会删除任一集合。
- 只有完成真实且通过验证的迁移后，才会修改生产配置默认值；不能只修改 `.env`。
- 新产物：`artifacts/embedding-migration-sprint22/{plan.json,
  validation.json,migration-result.json,report.md}`。不得触碰之前的产物目录
  （Sprints 18-21）。
- 必须针对 Docker Qdrant + 原生 Ollama 执行一次真实本地迁移，包括实际回滚演练，
  不能只运行单元测试。

## 测试计划

隔离测试（`:memory:` Qdrant、伪造/确定性的嵌入函数）覆盖：计划编制（模型、维度、
指令的指纹匹配/不匹配）、集合命名/隔离、完整迁移 + 幂等重跑 + 部分运行后的续作、
结构验证门禁（文档数、分块数、维度、指纹、集合缺失）、原子激活、回滚（包括对称性）、
失败处理（索引失败不触碰旧集合、切换后 smoke 失败自动回滚），以及配置/提供商接线
（`active_embedding_config`、启动模式不匹配保护、就绪状态）。
