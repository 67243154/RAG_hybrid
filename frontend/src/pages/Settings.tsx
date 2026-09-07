import { displayLabel } from "@/lib/labels"
import { BackgroundSettings } from "@/components/BackgroundSettings"
import { useQuery } from "@tanstack/react-query"
import { RotateCcw, ShieldAlert } from "lucide-react"

import { classifyError } from "@/api/client"
import { uiApi } from "@/api/ui"
import { ErrorState } from "@/components/ErrorState"
import { LoadingRows } from "@/components/LoadingSkeleton"
import { StatusBadge } from "@/components/StatusBadge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useIdentity } from "@/hooks/useIdentity"

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] py-2 text-xs last:border-0">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="font-technical text-[var(--color-foreground)]">{value}</span>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">设置</h1>
      <BackgroundSettings />
      <BackendSettings />
    </div>
  )
}

function BackendSettings() {
  const { data: identity } = useIdentity()
  const query = useQuery({ queryKey: ["settings"], queryFn: uiApi.settings })

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <LoadingRows rows={5} />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <ErrorState kind={classifyError(query.error)} detail={(query.error as Error).message} />
      </div>
    )
  }

  const data = query.data!
  const validationMode = data.security.validation_mode
  const validationModeLabel =
    validationMode === "strict" ? "严格" : validationMode === "fast" ? "快速" : validationMode
  const releasePolicy =
    validationMode === "strict"
      ? "验证通过后输出"
      : validationMode === "fast"
        ? "流式输出后验证"
        : "不可用"

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-muted-foreground)]">
        当前配置的只读视图。控制台无法修改后端设置。
      </p>

      <Card>
        <CardHeader>
          <CardTitle>当前处理流程</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="当前配置" value={`${data.active_pipeline.model_key}@${data.active_pipeline.output_dimension ?? data.active_pipeline.dimension}`} />
          <Row label="模型" value={data.active_pipeline.model} />
          <Row label="维度" value={data.active_pipeline.dimension} />
          <Row label="指纹" value={data.active_pipeline.fingerprint.slice(0, 16) + "…"} />
          <Row label="别名" value={data.active_pipeline.alias} />
          <Row
            label="当前集合"
            value={data.active_pipeline.active_collection ?? "不可用"}
          />
          <Row label="分块" value={data.active_pipeline.chunking.name} />
          <Row label="分词器" value={data.active_pipeline.chunking.tokenizer_model} />
          <Row
            label="目标长度 / 重叠长度"
            value={`${data.active_pipeline.chunking.target_tokens} / ${data.active_pipeline.chunking.overlap_tokens} tokens`}
          />
          <Row
            label="长度上限"
            value={data.active_pipeline.chunking.hard_max_tokens ?? "未限制"}
          />
          {data.active_pipeline.previous && (
            <Row
              label="上一版本"
              value={
                <span className="flex items-center gap-1.5">
                  <RotateCcw className="h-3 w-3" />
                  {data.active_pipeline.previous.model_key}@
                  {data.active_pipeline.previous.output_dimension ?? "原生维度"}
                </span>
              }
            />
          )}
          <Row
            label="可回滚"
            value={<StatusBadge status={data.active_pipeline.rollback_available ? "enabled" : "disabled"} />}
          />
          {!data.active_pipeline.available && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] p-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                无法获取实时迁移或别名状态，仅展示已配置的处理流程。
              </p>
            </div>
          )}
          <p className="mt-3 text-[11px] text-[var(--color-subtle-foreground)]">
            后端已实现并验证回滚功能（第 22 次迭代）。控制台未提供操作入口，需由管理员通过命令行执行（<code className="font-technical">scripts/migrate_embedding_index.py rollback</code>).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>检索</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="重排前候选数 k" value={data.retrieval.rerank_candidate_k} />
          <Row label="重排后保留数 n" value={data.retrieval.rerank_top_n} />
          <Row label="融合方式" value={data.retrieval.fusion} />
          <Row label="稀疏检索模型" value={data.retrieval.sparse_model} />
          <Row label="启用重排序" value={data.retrieval.reranker_enabled ? "是" : "否"} />
          <Row label="重排序后端" value={data.retrieval.reranker_backend} />
          <Row label="重排序模型" value={data.retrieval.reranker_model ?? "未启用"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>身份认证</CardTitle>
        </CardHeader>
        <CardContent>
          <Row
            label="已启用"
            value={<StatusBadge status={data.authentication.enabled ? "enabled" : "disabled"} />}
          />
          <Row label="认证方式" value={data.authentication.scheme} />
          <Row label="角色" value={data.authentication.roles.map(displayLabel).join(" < ")} />
          <Row label="当前身份" value={`${identity?.user_id} (${identity?.tenant_id})`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生成安全</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="提示词策略" value={data.security.prompt_policy_version} />
          <Row
            label="检索上下文"
            value={<StatusBadge status={data.security.untrusted_context_enabled ? "enabled" : "disabled"} />}
          />
          <Row label="验证模式" value={validationModeLabel} />
          <Row label="输出策略" value={releasePolicy} />
          <p className="mt-3 text-[11px] text-[var(--color-subtle-foreground)]">
            检索正文和元数据均视为不可信参考资料。后端在检索前执行权限检查。验证模式由服务端控制，客户端只能查看，无法降低严格验证要求。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>集成服务</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Qdrant" value={data.integrations.qdrant_url} />
          <Row label="Ollama" value={data.integrations.ollama_base_url} />
          <Row label="OpenTelemetry" value={data.integrations.otel_endpoint} />
          <Row label="生成服务商" value={data.integrations.generation_provider} />
          <Row label="生成模型" value={data.integrations.generation_model} />
        </CardContent>
      </Card>

      {!identity?.is_admin && (
        <Badge className="w-fit">回滚操作需要管理员角色</Badge>
      )}
    </div>
  )
}
