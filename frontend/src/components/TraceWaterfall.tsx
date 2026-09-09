import { displayLabel } from "@/lib/labels"
import { ExternalLink } from "lucide-react"

import type { TraceDetail } from "@/api/types"
import { EmptyState } from "@/components/EmptyState"
import { formatMs } from "@/lib/utils"

export function TraceWaterfall({ trace }: { trace: TraceDetail }) {
  if (!trace.available || trace.spans.length === 0) {
    return (
      <EmptyState
        title="链路尚未完成索引"
        description="Jaeger 异步采集数据，请稍后重试或直接打开查看。"
      />
    )
  }

  // Sequence-number spans whose name repeats (e.g. 向量化批次 ×4) so the
  // rows read as iterations rather than accidental duplicates.
  const nameCounts = new Map<string, number>()
  for (const span of trace.spans) nameCounts.set(span.name, (nameCounts.get(span.name) ?? 0) + 1)
  const seen = new Map<string, number>()

  const totalMs = Math.max(...trace.spans.map((s) => s.offset_ms + s.duration_ms))

  return (
    <div className="flex flex-col gap-2">
      {trace.spans.map((span) => {
        const leftPct = (span.offset_ms / totalMs) * 100
        const widthPct = Math.max((span.duration_ms / totalMs) * 100, 0.5)

        const count = nameCounts.get(span.name) ?? 1
        const index = (seen.get(span.name) ?? 0) + 1
        seen.set(span.name, index)
        const label = count > 1 ? `${displayLabel(span.name)} ${index}` : displayLabel(span.name)

        return (
          <div key={`${span.name}-${span.offset_ms}-${index}`} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-xs text-[var(--color-foreground)]">
              {label}
            </span>
            <div className="relative h-4 flex-1 rounded bg-[var(--color-surface-raised)]">
              <div
                className="absolute h-full rounded bg-[var(--color-accent)]"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-technical text-xs text-[var(--color-muted-foreground)]">
              {formatMs(span.duration_ms)}
            </span>
          </div>
        )
      })}
      <a
        href={`${trace.jaeger_url}/trace/${trace.trace_id}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex w-fit items-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        在 Jaeger 中打开
      </a>
    </div>
  )
}
