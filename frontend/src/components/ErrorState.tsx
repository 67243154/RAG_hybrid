import { AlertTriangle, Lock, ShieldOff, WifiOff } from "lucide-react"

import type { ApiErrorKind } from "@/api/client"

const COPY: Record<ApiErrorKind, { title: string; description: string; icon: typeof AlertTriangle }> = {
  unauthenticated: {
    title: "尚未登录",
    description: "请在顶部选择开发身份以继续。",
    icon: Lock,
  },
  forbidden: {
    title: "无访问权限",
    description: "当前角色或租户无权访问此资源。",
    icon: ShieldOff,
  },
  not_found: {
    title: "未找到",
    description: "此资源不存在或尚未创建。",
    icon: AlertTriangle,
  },
  conflict: {
    title: "正在执行",
    description: "此操作正在执行，请稍后重试。",
    icon: AlertTriangle,
  },
  unreachable: {
    title: "无法连接后端",
    description: "无法连接接口，请检查后端是否运行及跨域配置是否正确。",
    icon: WifiOff,
  },
  server_error: {
    title: "服务端发生错误",
    description: "接口返回错误，请查看后端日志了解详情。",
    icon: AlertTriangle,
  },
  unknown: {
    title: "发生错误",
    description: "发生了意外错误。",
    icon: AlertTriangle,
  },
}

export function ErrorState({ kind, detail }: { kind: ApiErrorKind; detail?: string }) {
  const copy = COPY[kind]
  const Icon = copy.icon
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error-muted)] px-6 py-10 text-center">
      <Icon className="mb-1 h-6 w-6 text-[var(--color-error)]" strokeWidth={1.75} />
      <p className="text-sm font-medium text-[var(--color-foreground)]">{copy.title}</p>
      <p className="max-w-sm text-xs text-[var(--color-muted-foreground)]">{copy.description}</p>
      {detail && (
        <code className="mt-1 max-w-md truncate rounded bg-black/20 px-2 py-1 font-technical text-[11px] text-[var(--color-subtle-foreground)]">
          {detail}
        </code>
      )}
    </div>
  )
}
