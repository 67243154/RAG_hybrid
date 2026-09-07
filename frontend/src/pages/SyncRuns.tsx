import { displayLabel } from "@/lib/labels"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Info, RefreshCw } from "lucide-react"
import { useState } from "react"

import { classifyError } from "@/api/client"
import { sourcesApi } from "@/api/sources"
import { syncApi } from "@/api/sync"
import type { SyncRun } from "@/api/types"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { LoadingRows } from "@/components/LoadingSkeleton"
import { StatusBadge } from "@/components/StatusBadge"
import { SyncRunTable } from "@/components/SyncRunTable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useIdentity } from "@/hooks/useIdentity"
import { formatRelativeTime } from "@/lib/utils"

function RunDetail({ run, onClose }: { run: SyncRun; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 z-20 w-96 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl">
      <button
        onClick={onClose}
        className="mb-4 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        ← 关闭
      </button>
      <h3 className="mb-3 text-sm font-medium capitalize text-[var(--color-foreground)]">
        任务 #{run.id} · {displayLabel(run.source_type)}
      </h3>
      <dl className="flex flex-col gap-2 text-xs">
        {[
          ["状态", displayLabel(run.status)],
          ["触发方式", displayLabel(run.trigger)],
          ["发现文件数", String(run.files_processed + run.files_skipped)],
          ["处理文件数", String(run.files_processed)],
          ["跳过文件数", String(run.files_skipped)],
          ["删除文件数", String(run.files_deleted)],
          ["写入或更新分块数", String(run.chunks_upserted)],
          ["开始时间", formatRelativeTime(run.started_at)],
          ["结束时间", run.finished_at ? formatRelativeTime(run.finished_at) : "进行中"],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-[var(--color-border)] py-1.5">
            <dt className="text-[var(--color-muted-foreground)]">{label}</dt>
            <dd className="font-technical text-[var(--color-foreground)]">{value}</dd>
          </div>
        ))}
      </dl>
      {run.error_message && (
        <div className="mt-3 rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-muted)] p-2 text-xs text-[var(--color-error)]">
          {run.error_message}
        </div>
      )}
      {run.trace_id && (
        <a
          href={`http://localhost:16686/trace/${run.trace_id}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          在 Jaeger 中查看链路
        </a>
      )}
    </div>
  )
}

export default function SyncRuns() {
  const { data: identity } = useIdentity()
  const [selectedRun, setSelectedRun] = useState<SyncRun | null>(null)
  const queryClient = useQueryClient()

  const sources = useQuery({ queryKey: ["sources"], queryFn: sourcesApi.list })
  const runs = useQuery({ queryKey: ["sync-runs"], queryFn: () => syncApi.allRuns() })

  const trigger = useMutation({
    mutationFn: (sourceType: string) => syncApi.trigger(sourceType),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-runs"] })
      queryClient.invalidateQueries({ queryKey: ["sources"] })
      queryClient.invalidateQueries({ queryKey: ["overview"] })
    },
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-foreground)]">同步任务</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {(sources.data ?? []).map((source) => (
          <div
            key={displayLabel(source.source_type)}
            className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
          >
            <span className="font-medium capitalize text-[var(--color-foreground)]">
              {displayLabel(source.source_type)}
            </span>
            <StatusBadge status={source.is_running ? "running" : "healthy"} />
            {identity?.can_sync ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={source.is_running || trigger.isPending}
                onClick={() => trigger.mutate(source.source_type)}
              >
                <RefreshCw className="h-3 w-3" />
                立即同步
              </Button>
            ) : (
              <span
                title="需要操作员或更高权限"
                className="flex items-center gap-1 text-[var(--color-subtle-foreground)]"
              >
                <Info className="h-3 w-3" />
                同步需要操作员权限
              </span>
            )}
          </div>
        ))}
      </div>

      {trigger.isError && (
        <ErrorState kind={classifyError(trigger.error)} detail={(trigger.error as Error).message} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>任务历史</CardTitle>
        </CardHeader>
        <CardContent>
          {(runs.data ?? []).length === 0 ? (
            <EmptyState title="暂无同步记录" description="执行同步后可在此查看历史记录。" />
          ) : (
            <SyncRunTable runs={runs.data!} onSelect={setSelectedRun} />
          )}
        </CardContent>
      </Card>

      {selectedRun && <RunDetail run={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  )
}
