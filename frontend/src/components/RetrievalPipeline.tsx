import { ArrowDown } from "lucide-react"

import type { RetrievalReportPayload } from "@/api/types"
import { formatMs, formatScore } from "@/lib/utils"

const STAGE_LABEL: Record<string, string> = {
  query_embedding: "问题向量化",
  sparse_encoding: "BM25 稀疏编码",
  hybrid_retrieval: "稠密 + 稀疏检索 → RRF 融合",
  rerank: "重排序器",
  truncate_to_top_n: "Top-k 筛选",
}

export function RetrievalPipeline({ report }: { report: RetrievalReportPayload }) {
  return (
    <div className="flex flex-col gap-1">
      {report.reranker && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-xs">
          <div className="font-medium text-[var(--color-foreground)]">当前重排序器</div>
          <div className="mt-1 font-technical text-[11px] text-[var(--color-muted-foreground)]">
            {report.reranker.enabled
              ? `${report.reranker.model ?? "—"} · ${report.reranker.backend ?? "—"} · ${report.reranker.candidate_k} → ${report.reranker.top_n}`
              : "已禁用 · 展示 RRF 混合检索结果"}
          </div>
        </div>
      )}
      {report.context && (
        <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs">
          <div className="font-medium text-[var(--color-foreground)]">检索上下文</div>
          <div className="mt-1 font-technical text-[11px] text-[var(--color-muted-foreground)]">
            分块： {report.context.retrieved_chunk_count ?? "—"} · 前 5 条上下文词元数： {report.context.top_context_tokens ?? "—"}
          </div>
        </div>
      )}
      {report.stages.map((stage, i) => (
        <div key={stage.name}>
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-foreground)]">
                {STAGE_LABEL[stage.name] ?? stage.name}
              </span>
              <span className="font-technical text-xs text-[var(--color-accent)]">
                {formatMs(stage.duration_ms)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-technical text-[11px] text-[var(--color-muted-foreground)]">
              <span>输入： {stage.candidates_in ?? "—"}</span>
              <span>输出： {stage.candidates_out ?? "—"}</span>
              <span>
                {stage.detail.fusion === "RRF" ? "RRF 得分" : "阶段得分"}: {formatScore(stage.top_score)}
              </span>
              {Object.entries(stage.detail).map(([key, value]) => (
                <span key={key} className="text-[var(--color-subtle-foreground)]">
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          </div>
          {i < report.stages.length - 1 && (
            <div className="flex justify-center py-0.5">
              <ArrowDown className="h-3 w-3 text-[var(--color-subtle-foreground)]" />
            </div>
          )}
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs">
        <span className="text-[var(--color-muted-foreground)]">检索总耗时</span>
        <span className="font-technical font-medium text-[var(--color-foreground)]">
          {formatMs(report.total_duration_ms)}
        </span>
      </div>
    </div>
  )
}
