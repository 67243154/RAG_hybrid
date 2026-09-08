# Phase 6C.6 — 固定义务支持评估

Phase 6C.6 在不可变的 48 条平衡缓存上，将之前的组合义务任务拆为两个实验阶段：

1. `query_obligation_extraction_v1` receives the user query only and extracts
   the minimal, bounded set of requested answer obligations.
2. `fixed_obligation_support_v1` receives those fixed obligations and the
   authorized top-five chunks, then returns support status per obligation.

最终的 `SUFFICIENT`/`INSUFFICIENT` 结果由 Python 计算：每项
obligation must be `SUPPORTED`. A supported obligation must cite an authorized
chunk ID; an unsupported obligation must cite none. Scope failures, extraction
failures, support failures, retrieval failures, and deterministic ACL safety
are reported separately.

现有 `sufficiency_v1` 实现保持不变并作为基线。查询范围决策复用
`query_scope_query_only_v1`; ACL-negative and non-clear scope rows do not reach
the two new stages. The extractor never receives retrieved content, and the
support evaluator never receives retrieval scores or benchmark labels.

## 平衡缓存实测结果

The run used `qwen3.5:4b`, `think=false`, candidate-k 20, top-n 5, and made no
retrieval, embedding, reranker, generation, calibration, or frozen-test calls.

| Metric | `sufficiency_v1` | fixed-obligation support |
|---|---:|---:|
| Sufficiency precision | 1.000 | 0.000 |
| Sufficiency recall | 0.538 | 0.000 |
| False sufficient | 0 | 0 |
| False insufficient | 6 | 1 |
| End-to-end ANSWER | 7 | 0 |
| Gold-present coverage | 7/20 | 0/20 |

提取可靠（首轮 `24/24`，无解析或超时失败），但支持输出只有 `11/24` 次有效。其余 13 次违反支持 schema/状态契约，主要是将 `UNSUPPORTED` 与支持块 ID 同时返回。因此候选状态为 `RELIABILITY_STILL_UNACCEPTABLE`，不能作为运行时推广依据。

## 产物与复现

可复现运行器为：

```bash
PYTHONPATH=. .venv/bin/python -m scripts.benchmarks.benchmark_fixed_obligation_support
```

它读取经过指纹校验的缓存
`artifacts/phase-6/semantic-balanced-smoke/`，并将组件结果、失败归因、可靠性、延迟、切片、转换及多文档报告写入 `artifacts/phase-6/fixed-obligation-support/`。当前产物记录语料/数据集指纹、集合、检索身份、模型及提示词/schema 版本。

提取组件作为独立边界具有潜力。剩余阻碍是支持阶段结构化输出及多义务支持映射不可靠；没有修改运行时门控或默认配置。
