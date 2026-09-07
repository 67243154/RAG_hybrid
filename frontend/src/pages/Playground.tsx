import { displayLabel } from "@/lib/labels"
import { useRef, useState } from "react"
import { ArrowUp, CheckCircle2, Square, XCircle } from "lucide-react"

import { chatApi } from "@/api/chat"
import type {
  ChatMetadata,
  GroundingResult,
  RetrievalReportPayload,
  RetrievedSource,
} from "@/api/types"
import { RetrievalPipeline } from "@/components/RetrievalPipeline"
import { SecurityInspector } from "@/components/SecurityInspector"
import { SourceCard } from "@/components/SourceCard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TraceWaterfall } from "@/components/TraceWaterfall"
import { useIdentity } from "@/hooks/useIdentity"
import { splitAnswerIntoSegments } from "@/lib/citations"
import { CitationChip } from "@/components/CitationChip"
import { formatMs } from "@/lib/utils"
import { EmptyState } from "@/components/EmptyState"
import { uiApi } from "@/api/ui"
import { useQuery } from "@tanstack/react-query"

interface Turn {
  question: string
  answer: string
  sources: RetrievedSource[]
  report: RetrievalReportPayload | null
  grounding: GroundingResult | null
  metadata: ChatMetadata | null
  streaming: boolean
  errorMessage: string | null
  // Sprint 24: client-observed wall-clock timings — real measured
  // durations (performance.now() deltas between real SSE events this
  // browser received), never a backend-reported value the stream
  // doesn't actually carry. The backend's SSE contract has no per-token
  // or per-check timing, so this is the only honest way to show
  // generation/grounding duration without fabricating it.
  firstTokenAt: number | null
  lastTokenAt: number | null
  groundingAt: number | null
  askStartedAt: number | null
}

export default function Playground() {
  const { data: identity } = useIdentity()
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState("")
  const [activeTab, setActiveTab] = useState("sources")
  const [highlightedRank, setHighlightedRank] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sourceRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const current = turns[turns.length - 1]

  const traceQuery = useQuery({
    queryKey: ["trace", current?.metadata?.trace_id],
    queryFn: () => uiApi.trace(current!.metadata!.trace_id),
    enabled: Boolean(current?.metadata?.trace_id) && activeTab === "trace",
    refetchInterval: (query) => (query.state.data?.available ? false : 2000),
  })

  function updateCurrent(patch: Partial<Turn>) {
    setTurns((prev) => {
      const copy = [...prev]
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch }
      return copy
    })
  }

  async function ask() {
    const q = question.trim()
    if (!q || current?.streaming) return
    setQuestion("")
    setTurns((prev) => [
      ...prev,
      {
        question: q,
        answer: "",
        sources: [],
        report: null,
        grounding: null,
        metadata: null,
        streaming: true,
        errorMessage: null,
        firstTokenAt: null,
        lastTokenAt: null,
        groundingAt: null,
        askStartedAt: performance.now(),
      },
    ])
    setActiveTab("sources")
    setHighlightedRank(null)

    const controller = new AbortController()
    abortRef.current = controller

    let answerBuffer = ""
    let firstTokenAt: number | null = null
    await chatApi.ask(
      q,
      {
        onSources: (sources) => updateCurrent({ sources: sources as RetrievedSource[] }),
        onRetrieval: (report) => updateCurrent({ report: report as RetrievalReportPayload }),
        onSecurity: (security) =>
          setTurns((prev) => {
            const copy = [...prev]
            const currentTurn = copy[copy.length - 1]
            if (!currentTurn?.report) return prev
            copy[copy.length - 1] = {
              ...currentTurn,
              report: {
                ...currentTurn.report,
                security: { ...currentTurn.report.security, ...(security as object) },
              },
            }
            return copy
          }),
        onMetadata: (metadata) => updateCurrent({ metadata: metadata as ChatMetadata }),
        onToken: (token) => {
          if (firstTokenAt === null) firstTokenAt = performance.now()
          answerBuffer += token
          updateCurrent({ answer: answerBuffer, firstTokenAt, lastTokenAt: performance.now() })
        },
        onGrounding: (grounding) =>
          updateCurrent({ grounding: grounding as GroundingResult, groundingAt: performance.now() }),
        onDone: () => updateCurrent({ streaming: false }),
        onError: (message) => updateCurrent({ streaming: false, errorMessage: message }),
      },
      controller.signal,
    )
  }

  function cancel() {
    abortRef.current?.abort()
    updateCurrent({ streaming: false, errorMessage: "已取消。" })
  }

  function focusSource(rank: number) {
    setActiveTab("sources")
    setHighlightedRank(rank)
    requestAnimationFrame(() => {
      sourceRefs.current.get(rank)?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  const perf = current?.report
    ? {
        embed: current.report.stages.find((s) => s.name === "query_embedding")?.duration_ms,
        retrieval: current.report.stages.find((s) => s.name === "hybrid_retrieval")?.duration_ms,
        rerank: current.report.stages.find((s) => s.name === "rerank")?.duration_ms,
      }
    : null
  // Client-observed (real, measured) timings — see the Turn interface's
  // comment for why these aren't backend-reported values.
  const llmMs =
    current?.askStartedAt && current?.lastTokenAt
      ? current.lastTokenAt - current.askStartedAt
      : null
  const groundingMs =
    current?.lastTokenAt && current?.groundingAt ? current.groundingAt - current.lastTokenAt : null
  const totalMs =
    current?.askStartedAt && current?.groundingAt
      ? current.groundingAt - current.askStartedAt
      : (current?.report?.total_duration_ms ?? null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* Conversation — ~55% */}
        <section className="flex w-[55%] flex-col border-r border-[var(--color-border)]">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {turns.length === 0 ? (
              <EmptyState
                title="就已导入的文档提问"
                description={`检索身份：${identity?.tenant_id ?? "…"} (${identity?.roles.map(displayLabel).join("、") ?? "…"})`}
              />
            ) : (
              <div className="flex flex-col gap-6">
                {turns.map((turn, i) => (
                  <div key={i} className="flex flex-col gap-3">
                    <div className="ml-auto max-w-[85%] rounded-lg bg-[var(--color-surface-raised)] px-3.5 py-2 text-sm text-[var(--color-foreground)]">
                      {turn.question}
                    </div>
                    <div className="max-w-[95%] text-sm leading-relaxed text-[var(--color-foreground)]">
                      {turn.errorMessage && turn.answer === "" ? (
                        <span className="text-[var(--color-error)]">{turn.errorMessage}</span>
                      ) : (
                        <>
                          {splitAnswerIntoSegments(turn.answer, turn.sources).map((seg, j) =>
                            seg.type === "text" ? (
                              <span key={j}>{seg.text}</span>
                            ) : (
                              <CitationChip
                                key={j}
                                rank={seg.source?.rank}
                                valid={seg.valid}
                                onClick={() => seg.source && focusSource(seg.source.rank)}
                              />
                            ),
                          )}
                          {turn.streaming && (
                            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--color-accent)]" />
                          )}
                        </>
                      )}
                    </div>
                    {turn.grounding && !turn.streaming && (
                      <div
                        className={`flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                          turn.grounding.grounded
                            ? "bg-[var(--color-success-muted)] text-[var(--color-success)]"
                            : "bg-[var(--color-error-muted)] text-[var(--color-error)]"
                        }`}
                      >
                        {turn.grounding.grounded ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {turn.grounding.grounded
                          ? "引用完整性验证通过"
                          : "引用验证失败"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-border)] p-3">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2">
              <input
                className="flex-1 bg-transparent text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-subtle-foreground)]"
                placeholder="请输入问题…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void ask()
                  }
                }}
                disabled={current?.streaming}
              />
              {current?.streaming ? (
                <button
                  type="button"
                  onClick={cancel}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-error-muted)] text-[var(--color-error)]"
                  aria-label="取消"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void ask()}
                  disabled={!question.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-foreground)] disabled:opacity-40"
                  aria-label="提问"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Evidence Inspector — ~45% */}
        <section className="flex w-[45%] flex-col overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
            <TabsList>
              <TabsTrigger value="sources">来源</TabsTrigger>
              <TabsTrigger value="retrieval">检索</TabsTrigger>
              <TabsTrigger value="security">安全</TabsTrigger>
              <TabsTrigger value="trace">链路</TabsTrigger>
            </TabsList>
            <div className="flex-1 overflow-y-auto p-4">
              <TabsContent value="sources">
                {!current || current.sources.length === 0 ? (
                  <EmptyState title="暂无来源" description="提问后可查看检索到的依据。" />
                ) : (
                  <div className="flex flex-col gap-2">
                    {current.sources.map((source) => (
                      <SourceCard
                        key={source.rank}
                        source={source}
                        cited={
                          current.grounding?.citations_found.some(
                            ([, sid]) => sid === source.source_id,
                          ) ?? false
                        }
                        highlighted={highlightedRank === source.rank}
                        cardRef={(el) => {
                          if (el) sourceRefs.current.set(source.rank, el)
                        }}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="retrieval">
                {!current?.report ? (
                  <EmptyState title="暂无检索数据" />
                ) : (
                  <RetrievalPipeline report={current.report} />
                )}
              </TabsContent>
              <TabsContent value="security">
                <SecurityInspector report={current?.report ?? null} identity={identity} />
              </TabsContent>
              <TabsContent value="trace">
                {!current?.metadata?.trace_id ? (
                  <EmptyState title="暂无链路数据" />
                ) : traceQuery.data ? (
                  <TraceWaterfall trace={traceQuery.data} />
                ) : (
                  <EmptyState title="正在加载链路…" description="Jaeger 数据采集为异步过程。" />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </section>
      </div>

      {/* Performance strip */}
      <footer className="flex shrink-0 items-center gap-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2 font-technical text-xs text-[var(--color-muted-foreground)]">
        <span>
          总耗时 <span className="text-[var(--color-foreground)]">{formatMs(totalMs)}</span>
        </span>
        <span>
          向量化 <span className="text-[var(--color-foreground)]">{formatMs(perf?.embed)}</span>
        </span>
        <span>
          检索{" "}
          <span className="text-[var(--color-foreground)]">{formatMs(perf?.retrieval)}</span>
        </span>
        <span>
          重排序 <span className="text-[var(--color-foreground)]">{formatMs(perf?.rerank)}</span>
        </span>
        <span>
          模型生成（客户端计时）{" "}
          <span className="text-[var(--color-foreground)]">{formatMs(llmMs)}</span>
        </span>
        <span>
          依据验证（客户端计时）{" "}
          <span className="text-[var(--color-foreground)]">{formatMs(groundingMs)}</span>
        </span>
      </footer>
    </div>
  )
}
