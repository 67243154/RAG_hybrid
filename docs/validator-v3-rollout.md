# Validator V3 上线

`VALIDATOR_CANDIDATE_V3_44dd8bdd2c0b` 已接入由服务端维护的 `CRITICAL_VALIDATOR_VERSION` 选择器。其冻结组成包括数值规范化、版本规范化、标识符/负值处理、地区歧义保护和版本特异性保护。地区和版本特异性歧义仍保守地产生 `INDETERMINATE` 结果；support-ID 授权仍是独立的安全边界。

选择器接受 `baseline`、`v3` 或 `architecture_v2`，组合运行时默认使用 `architecture_v2`。可选设置 `CRITICAL_VALIDATOR_V3_SHADOW_ENABLED` 默认为 `false`。与 baseline 选择器一起启用时，V3 只对相同的 claim/support 输入进行有限诊断；可见答案和拒答行为仍由 baseline 控制。遥测记录版本、结果、有界 reason/type 字段、分歧类别、影子错误类别、强制拒答状态，以及 baseline/V3 分开的本地处理耗时。影子异常会被隔离，不会导致 baseline 答案路径失败。不会记录原始 claims、查询、support 文本或租户敏感证据。

V3 的独立验证已通过，但仍有两个已知的可用性误报：`12.00 hours` 与 `12 hours`，以及 `100.0%` 与 `100%`。本次集成不会改变它们。

回滚只需在边界处修改配置：设置 `CRITICAL_VALIDATOR_VERSION=baseline` 或 `v3`，然后按正常配置流程重启/重新部署。无需重建索引、迁移、重写数据、重新加载模型或重新生成产物。Architecture V2 是组合运行时的默认验证器；V3 继续用于兼容和调试。
