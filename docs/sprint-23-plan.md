# Sprint 23 计划 — 安全边界与租户感知检索

## 目标

完成原始路线图的第一阶段：让“哪个租户有权查看这个分块”成为由服务器负责的强制性问题，
并由检索层在候选内容到达重排序器或生成阶段之前回答——它不是提示词指令，也不是事后引用检查。

## 安全模型

`UserContext(user_id, tenant_id, roles)` 只能通过
`app/security/auth.py::TokenAuthenticator` 从经过验证的
`Authorization: Bearer <token>` 构建，绝不能来自请求体或查询数据。角色按线性关系排列：
`USER < OPERATOR < ADMIN`。
`RetrievalContext(tenant_id, is_system)` 是有意独立的类型——只有
`RetrievalContext.system()` 才能执行跨租户检索，并且本代码库中的真实请求绝不会构造这种上下文。

## 强制 ACL 执行

`app/retrieval/search.py::search()` 新增必填的 `context:
RetrievalContext` 参数（无默认值）。`app/retrieval/filters.py::
build_acl_filter` 根据该参数构造 `tenant_id == ...` 条件——只有明确的系统上下文才返回
`None`，其他缺少 tenant_id 的情况都抛出 `MissingTenantContextError`（默认拒绝，绝不“返回全部”）。
`combine_filters()` 将 ACL 与用户提供的过滤条件执行 AND；恶意指定其他租户的过滤器只会缩小结果，
不会扩大结果。

## 分块/注册表/点身份变更

- `Chunk` 新增 `tenant_id: str = "default"`，在分块后立即通过
  `ingest_connector` 中的 `dataclasses.replace()` 设置（分块函数本身仍与租户无关）。
- Qdrant 负载新增 `tenant_id` + `visibility`（目前为 "tenant"）。
- `QdrantStore.point_id_for` 将 `tenant_id` 纳入规范键，
  `CURRENT_INDEX_SCHEMA_VERSION` 从 3 提升到 4（所有现有点 ID 都会变化）。
- `DocumentRegistry` 的主键通过真实的重命名-重建-复制-删除迁移
  （`_migrate_add_tenant_id_and_rebuild_pk`）从 `(source_type, source_id)` 扩展为
  `(tenant_id, source_type, source_id)`，所有已有行回填为 `tenant_id="default"`。
- 每个文档级别的 Qdrant 维护方法（`delete_by_source`、`delete_stale_versions`、
  `delete_version`、`has_document_version`、`count_for_document_version`、
  `list_point_ids_for_version`、`list_source_ids`）都新增了 `tenant_id` 参数。

## 端点授权

- `/chat`：USER+，从解析后的令牌构造 `RetrievalContext.for_user()`，绝不读取请求体。
- `/sources`：USER+，按租户隔离（其他租户拥有的 source_type 完全不会出现）。
- `/sync/{source_type}` 和 `/sync/{source_type}/history`：OPERATOR+，并且调用者的租户必须拥有
  该 source_type（`app/api/sync.py::_require_owned_source_type`）。

## 摄取时的租户所有权

每个 source_type 一个连接器实例（本应用现有架构）意味着每个 source_type 对应一个租户，
并在服务器端配置（`FILESYSTEM_TENANT_ID`、`NOTION_TENANT_ID`）。`SyncManager` 新增
`tenant_ids: dict[str, str]` 映射，并传入它发起的每次 `ingest_connector()` 调用。

## 验证策略

- 针对认证、RBAC、ACL 过滤器构造/组合、注册表/点身份隔离的隔离单元测试——无需真实服务。
- `tests/test_cross_tenant_e2e.py`：真实 Qdrant 服务（必需，因为 `:memory:` 会在混合预取+融合查询
  中静默丢弃过滤器），两个共享同一集合的真实租户，覆盖稠密/稀疏/混合隔离、过滤器覆盖攻击、
  重排序器输入隔离和引用泄漏。
- 使用真实令牌、真实 Ollama 嵌入和真实 Qdrant 驱动实际 `app.main.create_app()` FastAPI 应用的
  本地脚本（不提交，仅临时使用），生成 `artifacts/security-sprint23/{security-validation.json,report.md}`。

## 明确不在范围内

提示词注入/不可信上下文防御、真实 IdP/OAuth/OIDC、多语言重排序器变更、分块器重设计、
vLLM/PostgreSQL 迁移、分布式任务队列——详见 `docs/security.md` 的 Known limitations。
