# Sprint 12 计划 — 安全与正确性

## 目标

修复外部代码审查发现的两个真实正确性/安全问题，并加入项目首个 CI。两项问题均已对照当前代码确认，没有发生漂移。

## 问题 1：无引用时错误地报告 `grounded=True`

旧逻辑在 `citations_found` 为空时得到空的 `ungrounded_citations`，从而把没有引用的回答判为 grounded。这会让没有任何引用的事实性幻觉在 UI 和 `generate.grounded` 中显示为绿色通过。唯一有意无引用的情况是 `NOT_FOUND_PHRASE`，它不作事实声明。

将 `GroundingResult` 拆成更明确的字段：

```python
@dataclass(frozen=True)
class GroundingResult:
    has_citations: bool
    citations_valid: bool
    grounded: bool  # has_citations and citations_valid
    citations_found: list[tuple[str, str, str]]
    ungrounded_citations: list[tuple[str, str, str]]
```

保留 `.grounded`，因此 `app/llm/generate.py` 和 SSE 调用方无需重构；`app/ui/pages/chat.py` 根据 `has_citations` 增加第三种中性状态：无引用时提示“无需验证”，有无效引用时显示警告，全部有效时显示 grounded。测试中原本把旧行为当作规格的 `tests/test_grounding.py::test_grounding_with_no_citations_at_all_is_considered_grounded` 改为新断言。

README 明确说明 `check_grounding` 实际是引用完整性校验：它只验证引用标签指向检索上下文中的真实块，不证明引用文本在语义上支持相邻事实。声明级 NLI/蕴含校验列为后续工作。

## 问题 2：schema 不匹配时 `ensure_collection()` 静默删除集合

旧逻辑在已有集合缺少所需 sparse vector 时调用 `delete_collection()`，可能无提示地删除生产数据。改为快速失败并保持数据不变：

```python
class UnexpectedCollectionSchemaError(Exception):
    """Raised when an existing Qdrant collection doesn't have the sparse
    vector this app requires, instead of silently deleting it — see
    docs/sprint-12-plan.md."""
```

开发者必须显式删除空的开发集合或指定新的集合名，不能由 `ensure_collection()` 自行决定。

## CI

`production-rag-platform` 没有可复用的 workflow，因此从零设计：

- **lint**：`ruff check app tests`，无需服务。
- **test**：使用 `qdrant/qdrant:v1.12.4` 服务容器；现有测试通过 `_port_open("localhost", 6333)` 自动跳过无服务环境，Qdrant 端到端测试在 CI 中实际运行。CI 不启动 Ollama，因为需要原生二进制和多 GB 模型下载；Ollama 测试会在端口不可达时跳过。
- **docker-build**：只执行 `docker build .`，不运行容器，避免导入时下载 HuggingFace 模型导致网络不稳定；仍能捕获 Dockerfile、依赖解析（包括 CUDA/torch 回归）和 COPY 错误。

触发条件为推送到 `main` 和 pull request，不设置定时任务。
