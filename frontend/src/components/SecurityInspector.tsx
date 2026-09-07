import { displayLabel } from "@/lib/labels"
import { ArrowDown, ShieldCheck } from "lucide-react"

import type { RetrievalReportPayload } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import type { Identity } from "@/api/types"

export function SecurityInspector({
  report,
  identity,
}: {
  report: RetrievalReportPayload | null
  identity: Identity | undefined
}) {
  if (!report) {
    return (
      <p className="text-xs text-[var(--color-muted-foreground)]">
        提问后可查看本次检索的授权上下文。
      </p>
    )
  }

  const auth = report.authorization
  const mode = report.security.security_validation_mode
  const modeLabel = mode === "strict" ? "严格" : mode === "fast" ? "快速" : mode ?? "—"
  const releasePolicy =
    mode === "strict"
      ? "验证通过后输出"
      : mode === "fast"
        ? "流式输出后验证"
        : "—"

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-foreground)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-success)]" />
          权限检查
        </div>
        <div className="mt-2 grid grid-cols-2 gap-y-1.5 text-xs">
          <span className="text-[var(--color-muted-foreground)]">租户访问控制</span>
          <Badge variant={auth.acl_applied ? "success" : "warning"} className="w-fit">
            {auth.acl_applied ? "已应用" : "未应用（系统上下文）"}
          </Badge>
          <span className="text-[var(--color-muted-foreground)]">租户</span>
          <span className="font-technical text-[var(--color-foreground)]">
            {auth.tenant_id ?? "—"}
          </span>
          <span className="text-[var(--color-muted-foreground)]">角色</span>
          <span className="font-technical text-[var(--color-foreground)]">
            {identity?.roles.map(displayLabel).join("、") ?? "—"}
          </span>
          <span className="text-[var(--color-muted-foreground)]">检索上下文</span>
          <span className="font-technical text-[var(--color-foreground)]">
            {auth.is_system_context ? "系统（特权）" : "已认证用户"}
          </span>
          <span className="text-[var(--color-muted-foreground)]">已应用用户筛选条件</span>
          <span className="font-technical text-[var(--color-foreground)]">
            {auth.user_filters_applied ? "是" : "否"}
          </span>
        </div>
      </div>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
        <div className="mb-2 text-xs font-medium text-[var(--color-foreground)]">
          不可信 RAG 上下文
        </div>
        <div className="grid grid-cols-2 gap-y-1.5 text-xs">
          <span className="text-[var(--color-muted-foreground)]">上下文边界</span>
          <Badge variant={report.security.untrusted_context_enabled ? "success" : "warning"} className="w-fit">
            {report.security.untrusted_context_enabled ? "已隔离" : "未启用"}
          </Badge>
          <span className="text-[var(--color-muted-foreground)]">提示词策略</span>
          <span className="font-technical text-[var(--color-foreground)]">
            {report.security.prompt_policy_version ?? "—"}
          </span>
          <span className="text-[var(--color-muted-foreground)]">输出验证</span>
          <span className="font-technical text-[var(--color-foreground)]">
            {modeLabel}
            {report.security.output_policy_passed === null
              ? " · 尚未测量"
              : report.security.output_policy_passed
                ? " · 已通过"
                : " · 未通过"}
          </span>
          <span className="text-[var(--color-muted-foreground)]">输出策略</span>
          <span className="font-technical text-[var(--color-foreground)]">{releasePolicy}</span>
        </div>
        {report.security.output_policy_violations.length > 0 && (
          <p className="mt-2 text-[11px] text-[var(--color-error)]">
            违规项： {report.security.output_policy_violations.join(", ")}
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-[var(--color-foreground)]">权限执行流程</p>
        <div className="flex flex-col items-center gap-1 text-xs">
          {["用户上下文", "强制访问控制筛选", "Qdrant", "仅保留已授权候选项"].map(
            (step, i, arr) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 font-technical text-[var(--color-foreground)]">
                  {step}
                </div>
                {i < arr.length - 1 && (
                  <ArrowDown className="h-3 w-3 text-[var(--color-subtle-foreground)]" />
                )}
              </div>
            ),
          )}
        </div>
      </div>

      <p className="text-[11px] leading-snug text-[var(--color-subtle-foreground)]">
        上述租户筛选在融合或重排前已应用于 Qdrant 查询，不属于 {auth.tenant_id ?? "当前租户"} 的候选项无法进入本次回答的候选集合。
      </p>
    </div>
  )
}
