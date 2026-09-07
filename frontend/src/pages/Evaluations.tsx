import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, XCircle } from "lucide-react"

import { classifyError } from "@/api/client"
import { uiApi } from "@/api/ui"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { EvaluationMetric } from "@/components/EvaluationMetric"
import { LoadingRows } from "@/components/LoadingSkeleton"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { displayLabel } from "@/lib/labels"

const DECISION_RULES: Record<string, string> = {
  "Adopt multilingual when cross-lingual Recall@5 and MRR are >= OFF, mono Recall@5 regression <= 0.01, and total retrieval p95 <= 3000ms.":
    "当跨语言 Recall@5 和 MRR 不低于关闭重排序的结果、单语言 Recall@5 下降不超过 0.01，且检索总耗时 p95 不超过 3000 毫秒时，采用多语言重排序模型。",
  "Quality floor first: overall Recall@5 >= baseline -0.01, cross Recall@5 >= baseline -0.01, MRR >= baseline -0.02, zero hard-max violations; a candidate must then Pareto-dominate baseline on context tokens, chunk count, or storage before adoption.":
    "先满足质量底线：整体 Recall@5 不低于基线 0.01，跨语言 Recall@5 不低于基线 0.01，MRR 不低于基线 0.02，且没有硬上限违规；随后候选方案还必须在上下文词元数、分块数或存储量上至少一项优于基线且其他项不变差，才可采用。",
}

function displayDecisionRule(rule: string | null | undefined) {
  return rule ? (DECISION_RULES[rule] ?? rule) : "—"
}

// Sprint 24 section 24: metrics this platform doesn't measure YET —
// shown as a disabled placeholder row so the page's design communicates
// where the metric surface grows next, without pretending the numbers
// exist today.
const PLANNED_METRICS = [
  "重排序提升",
  "拒答准确率",
  "忠实度",
  "引用精确率",
  "论断支持度",
  "注入防御能力",
]

function formatMetric(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(4) : "—"
}

function formatLatency(value: number | string | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(1)} ms` : value ?? "—"
}

function formatCount(value: number | string | null | undefined) {
  return typeof value === "number" ? value.toFixed(1) : value ?? "—"
}

export default function Evaluations() {
  const query = useQuery({ queryKey: ["evaluations"], queryFn: uiApi.evaluations })

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <LoadingRows rows={4} />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <ErrorState kind={classifyError(query.error)} detail={(query.error as Error).message} />
      </div>
    )
  }

  const data = query.data!

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">评估</h1>

      <Card>
        <CardHeader>
          <CardTitle>当前生产基线</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.baseline ? (
            <EmptyState
              title="暂无基准评估结果"
              description="运行 scripts/benchmark_stability.py 生成 artifacts/embedding-benchmark-sprint21/stability.json。"
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                {data.baseline.config} · 来源： {data.baseline.source}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.baseline.metrics.map((metric) => (
                  <EvaluationMetric key={metric.key} metric={metric} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>重排序方案决策</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.reranker_decision ? (
            <EmptyState
              title="暂无重排序基准结果"
              description="运行 python -m scripts.benchmark_rerankers 生成第 26 次迭代的评估结果。"
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                {data.reranker_decision.question_count} 个问题 · 建议： {displayLabel(data.reranker_decision.recommendation)} · 来源： {data.reranker_decision.source}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="pb-2 pr-3">配置</th>
                      <th className="pb-2 pr-3">跨语言 R@5</th>
                      <th className="pb-2 pr-3">跨语言 MRR</th>
                      <th className="pb-2 pr-3">单语言 R@5</th>
                      <th className="pb-2">总耗时 p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reranker_decision.configs.map((config) => (
                      <tr key={config.config} className="border-t border-[var(--color-border)]">
                        <td className="py-2 pr-3 font-medium">{config.config}</td>
                        <td className="py-2 pr-3 font-technical">{formatMetric(config.cross_lingual.recall_at_5)}</td>
                        <td className="py-2 pr-3 font-technical">{formatMetric(config.cross_lingual.mrr)}</td>
                        <td className="py-2 pr-3 font-technical">{formatMetric(config.mono_lingual.recall_at_5)}</td>
                        <td className="py-2 font-technical">{formatLatency(config.latency.total_retrieval_p95_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-subtle-foreground)]">{displayDecisionRule(data.reranker_decision.rule)}</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>分块方案决策</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.chunking_decision ? (
            <EmptyState
              title="暂无分块基准结果"
              description="运行 python -m scripts.benchmark_chunking 生成第 27 次迭代的评估结果。"
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                {data.chunking_decision.question_count} 个问题 · 建议： {displayLabel(data.chunking_decision.recommendation)} · 来源： {data.chunking_decision.source}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="pb-2 pr-3">配置</th>
                      <th className="pb-2 pr-3">R@5</th>
                      <th className="pb-2 pr-3">跨语言 R@5</th>
                      <th className="pb-2 pr-3">平均上下文长度</th>
                      <th className="pb-2">分块数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.chunking_decision.configs.map((config) => (
                      <tr key={config.config} className="border-t border-[var(--color-border)]">
                        <td className="py-2 pr-3 font-medium">{config.config}</td>
                        <td className="py-2 pr-3 font-technical">{formatMetric(config.overall.recall_at_5)}</td>
                        <td className="py-2 pr-3 font-technical">{formatMetric(config.cross_lingual.recall_at_5)}</td>
                        <td className="py-2 pr-3 font-technical">{formatCount(config.context_efficiency.avg_top5_context_tokens)}</td>
                        <td className="py-2 font-technical">{String(config.chunk_stats.total_chunks ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-subtle-foreground)]">{displayDecisionRule(data.chunking_decision.rule)}</p>
            </>
          )}
        </CardContent>
      </Card>

      {data.migration_quality_gate && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>迁移质量检查</CardTitle>
            <Badge variant={data.migration_quality_gate.passed ? "success" : "error"}>
              {data.migration_quality_gate.passed ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {data.migration_quality_gate.passed ? "通过" : "失败"}
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
              {data.migration_quality_gate.question_count} 个问题 · 容差{" "}
              {data.migration_quality_gate.tolerance}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["跨语言召回率@5", data.migration_quality_gate.cross_recall_at_5],
                ["跨语言 MRR", data.migration_quality_gate.cross_mrr],
                ["单语言召回率@5", data.migration_quality_gate.mono_recall_at_5],
                ["nDCG@5", data.migration_quality_gate.ndcg_at_5],
              ].map(([label, value]) => (
                <EvaluationMetric
                  key={label as string}
                  metric={{ key: label as string, label: label as string, value: value as number, stddev: null, runs: null }}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>提示词注入</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.prompt_injection ? (
            <EmptyState
              title="暂无安全评估结果"
              description="运行 python -m scripts.evaluate_prompt_injection 生成第 25 次迭代的评估结果。"
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--color-muted-foreground)]">
                {data.prompt_injection.case_count} 个案例 · {data.prompt_injection.prompt_version} · {data.prompt_injection.mode} · 来源： {data.prompt_injection.source}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ["注入成功率", "injection_success_rate"],
                  ["引用伪造率", "citation_spoof_success_rate"],
                  ["引用抑制率", "citation_suppression_success_rate"],
                  ["未授权引用率", "unauthorized_citation_rate"],
                  ["跨租户数据泄露率", "cross_tenant_exfiltration_rate"],
                  ["正常问题回答成功率", "benign_answer_success_rate"],
                ].map(([label, key]) => (
                  <EvaluationMetric
                    key={key}
                    metric={{
                      key,
                      label,
                      value: data.prompt_injection!.metrics[key] ?? null,
                      stddev: null,
                      runs: null,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>嵌入模型决策历史</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3 border-l border-[var(--color-border)] pl-4">
            {data.timeline.map((entry) => (
              <li key={entry.sprint} className="relative">
                <span
                  className={cn(
                    "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full",
                    entry.available ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]",
                  )}
                />
                <div className="flex items-center gap-2">
                  <span className="font-technical text-xs text-[var(--color-subtle-foreground)]">
                    迭代 {entry.sprint}
                  </span>
                  <span className="text-sm font-medium text-[var(--color-foreground)]">
                    {entry.title}
                  </span>
                  {!entry.available && <Badge>暂无结果文件</Badge>}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">{entry.question}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>计划评估指标</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PLANNED_METRICS.map((metric) => (
              <Badge key={metric} className="opacity-60">
                {metric} — 尚未测量
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
