const labels: Record<string, string> = {
  success: "成功", healthy: "正常", ready: "就绪", enabled: "已启用",
  disabled: "已禁用", running: "运行中", pending: "待处理", degraded: "服务降级",
  rejected: "已拒绝", error: "错误", failed: "失败", cancelled: "已取消",
  unavailable: "不可用", indexed: "已索引", deleted: "已删除", completed: "已完成",
  manual: "手动", scheduled: "定时", scheduler: "定时", startup: "启动",
  filesystem: "本地文件", user: "用户", operator: "操作员", admin: "管理员",
  strict: "严格", fast: "快速", baseline: "基线", token_aware: "词元感知",
  query_embedding: "问题向量化", embed_query: "问题向量化", hybrid_retrieval: "混合检索", rerank: "重排序",
  generate: "回答生成", chat_request: "问答请求", sparse_encoding: "稀疏编码",
  retrieve_hybrid: "混合检索", build_acl_filter: "构建访问控制筛选",
  evidence_build: "证据构建", support_unit_validation: "证据单元校验",
  sync_run: "同步任务", ingest_connector: "文档摄取", fetch_documents: "拉取文档",
  fetch_qdrant_source_ids: "查询已索引 ID", check_document: "文档变更检查",
  ingest_document: "摄取文档", parse_and_chunk: "解析与切分",
  embed_batch: "向量化批次", upsert_batch: "写入向量库批次",
  cleanup_duplicate_points: "清理重复向量点", delete_stale_chunks: "删除旧版本分块",
  delete_document: "删除文档", rollback_partial_version: "回滚部分版本",
  fetch: "拉取文档内容", ensure_collection: "检查向量集合",
  record_run_start: "记录同步开始", record_run_finish: "记录同步结束",
  grounding: "依据验证", answer: "回答", abstain: "拒答",
  available: "可用", authenticated: "已认证", system: "系统",
  bearer: "Bearer 令牌", deepseek: "DeepSeek", openai: "OpenAI",
  adopt_multilingual: "采用多语言重排序模型", keep_current: "保持当前配置",
  need_more_data: "需要更多数据", adopt_qwen3: "采用 Qwen3 嵌入模型",
}

export function displayLabel(value: string): string {
  return labels[value.toLowerCase()] ?? value
}
