import { displayLabel } from "@/lib/labels"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { classifyError } from "@/api/client"
import { syncApi } from "@/api/sync"
import { uiApi } from "@/api/ui"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { LoadingRows } from "@/components/LoadingSkeleton"
import { StatusBadge } from "@/components/StatusBadge"
import { TraceWaterfall } from "@/components/TraceWaterfall"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatRelativeTime } from "@/lib/utils"

export default function Traces() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Sprint 24: this platform doesn't persist a general trace index —
  // the real, currently available source of past trace_ids is sync run
  // history (app/api/ui.py::sync_runs). A chat request's trace_id is
  // only known to the Playground session that made it; there is no
  // server-side store of past chat traces to list here yet. This page
  // is honest about that rather than fabricating a trace search feature
  // the backend doesn't back.
  const runs = useQuery({ queryKey: ["sync-runs"], queryFn: () => syncApi.allRuns(50) })
  const trace = useQuery({
    queryKey: ["trace", selectedTraceId],
    queryFn: () => uiApi.trace(selectedTraceId!),
    enabled: Boolean(selectedTraceId),
  })

  if (runs.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <LoadingRows rows={5} />
      </div>
    )
  }
  if (runs.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <ErrorState kind={classifyError(runs.error)} detail={(runs.error as Error).message} />
      </div>
    )
  }

  const tracedRuns = (runs.data ?? []).filter((r) => r.trace_id)
  const filtered =
    statusFilter === "all" ? tracedRuns : tracedRuns.filter((r) => r.status === statusFilter)
  const statuses = Array.from(new Set(tracedRuns.map((r) => r.status)))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-foreground)]">链路追踪</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-[var(--color-foreground)] outline-none"
        >
          <option value="all">全部状态</option>
          {statuses.map((s) => (
            <option key={displayLabel(s)} value={displayLabel(s)}>
              {displayLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[var(--color-muted-foreground)]">
        此处展示同步任务的链路。问答链路可在知识库问答页的“链路”标签中查看，目前尚未持久化统一的问答链路索引。
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>最近链路</CardTitle>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <EmptyState title="暂无包含链路的同步任务" />
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((run) => (
                  <li key={run.id}>
                    <button
                      onClick={() => setSelectedTraceId(run.trace_id)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-[var(--color-surface-hover)] ${
                        selectedTraceId === run.trace_id ? "bg-[var(--color-accent-muted)]" : ""
                      }`}
                    >
                      <div>
                        <div className="font-technical capitalize text-[var(--color-foreground)]">
                          同步 · {displayLabel(run.source_type)}
                        </div>
                        <div className="text-[var(--color-subtle-foreground)]">
                          {formatRelativeTime(run.started_at)}
                        </div>
                      </div>
                      <StatusBadge status={run.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>耗时瀑布图</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedTraceId ? (
              <EmptyState title="选择一条链路" description="选择左侧链路以查看各阶段耗时。" />
            ) : trace.data ? (
              <TraceWaterfall trace={trace.data} />
            ) : (
              <LoadingRows rows={3} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
