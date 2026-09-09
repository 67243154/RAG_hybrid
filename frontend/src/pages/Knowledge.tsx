import { displayLabel } from "@/lib/labels"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronRight, Database, FileText, Plus, Trash2, Upload } from "lucide-react"
import { useRef, useState } from "react"

import { classifyError } from "@/api/client"
import { sourcesApi } from "@/api/sources"
import type { DocumentRecord } from "@/api/types"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { LoadingRows } from "@/components/LoadingSkeleton"
import { StatusBadge } from "@/components/StatusBadge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useIdentity } from "@/hooks/useIdentity"
import { formatRelativeTime } from "@/lib/utils"

function DocumentDetail({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 z-20 w-96 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl">
      <button
        onClick={onClose}
        className="mb-4 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        ← 关闭
      </button>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
        <FileText className="h-4 w-4" />
        {doc.source_id}
      </h3>
      <dl className="flex flex-col gap-2 text-xs">
        {[
          ["来源", displayLabel(doc.source_type)],
          ["当前版本", String(doc.version)],
          ["内容哈希", doc.content_hash],
          ["流程指纹", doc.pipeline_fingerprint ?? "未统计"],
          ["分块数量", doc.chunk_count === null ? "未统计" : String(doc.chunk_count)],
          ["索引时间", formatRelativeTime(doc.last_synced_at)],
          ["状态", displayLabel(doc.status)],
          ["租户", doc.tenant_id],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-[var(--color-border)] py-1.5">
            <dt className="text-[var(--color-muted-foreground)]">{label}</dt>
            <dd className="truncate font-technical text-[var(--color-foreground)]" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function Knowledge() {
  const queryClient = useQueryClient()
  const { data: identity } = useIdentity()
  const [selectedSourceType, setSelectedSourceType] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null)
  const [search, setSearch] = useState("")
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const sources = useQuery({ queryKey: ["sources"], queryFn: sourcesApi.list })
  const documents = useQuery({
    queryKey: ["documents", selectedSourceType],
    queryFn: () => sourcesApi.documents(selectedSourceType ?? undefined),
    enabled: Boolean(selectedSourceType),
  })
  const refreshKnowledge = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sources"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "filesystem"] }),
      queryClient.invalidateQueries({ queryKey: ["sync-runs"] }),
    ])
  }
  const upload = useMutation({
    mutationFn: sourcesApi.upload,
    onSuccess: async (result) => {
      setFeedback({
        kind: result.sync.status === "success" ? "success" : "error",
        text:
          result.sync.status === "success"
            ? `“${result.filename}”已添加并完成索引。`
            : `“${result.filename}”已添加，索引任务状态：${displayLabel(result.sync.status)}。`,
      })
      await refreshKnowledge()
    },
    onError: (error: Error) => setFeedback({ kind: "error", text: error.message }),
  })
  const remove = useMutation({
    mutationFn: sourcesApi.remove,
    onSuccess: async (result) => {
      setSelectedDoc((current) => (current?.source_id === result.source_id ? null : current))
      setFeedback({
        kind: result.sync.status === "success" ? "success" : "error",
        text:
          result.sync.status === "success"
            ? `“${result.filename}”已删除，相关索引已清理。`
            : `“${result.filename}”已删除，索引任务状态：${displayLabel(result.sync.status)}。`,
      })
      await refreshKnowledge()
    },
    onError: (error: Error) => setFeedback({ kind: "error", text: error.message }),
  })

  const canManageLocalFiles = selectedSourceType === "filesystem" && identity?.can_sync === true

  if (sources.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <LoadingRows rows={3} />
      </div>
    )
  }
  if (sources.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <ErrorState kind={classifyError(sources.error)} detail={(sources.error as Error).message} />
      </div>
    )
  }

  const filteredDocs = (documents.data ?? []).filter((d) =>
    d.source_id.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-[var(--color-foreground)]">知识来源</h1>

      {sources.data!.length === 0 ? (
        <EmptyState
          icon={Database}
          title="当前租户尚未配置来源"
          description="当前租户尚无连接器导入文档。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sources.data!.map((source) => (
            <button
              key={displayLabel(source.source_type)}
              onClick={() => setSelectedSourceType(source.source_type)}
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize text-[var(--color-foreground)]">
                    {displayLabel(source.source_type)}
                  </span>
                  <StatusBadge status={source.is_running ? "running" : "healthy"} />
                </div>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {source.document_count} 篇文档
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--color-subtle-foreground)]" />
            </button>
          ))}
        </div>
      )}

      {selectedSourceType && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="capitalize">{displayLabel(selectedSourceType)} 文档</CardTitle>
            <div className="flex items-center gap-2">
              <input
                placeholder="按名称筛选…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1.5 text-xs text-[var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              />
              {selectedSourceType === "filesystem" && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.md,application/pdf,text/markdown"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ""
                      if (file) {
                        setFeedback(null)
                        upload.mutate(file)
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canManageLocalFiles || upload.isPending || remove.isPending}
                    title={canManageLocalFiles ? "添加 PDF 或 Markdown 文件" : "需要操作员权限"}
                  >
                    {upload.isPending ? <Upload className="h-3.5 w-3.5 animate-pulse" /> : <Plus className="h-3.5 w-3.5" />}
                    {upload.isPending ? "添加中…" : "添加文件"}
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {feedback && (
              <div
                role="status"
                className={`mb-3 rounded-md border px-3 py-2 text-xs ${
                  feedback.kind === "success"
                    ? "border-[var(--color-success)]/30 bg-[var(--color-success-muted)] text-[var(--color-success)]"
                    : "border-[var(--color-error)]/30 bg-[var(--color-error-muted)] text-[var(--color-error)]"
                }`}
              >
                {feedback.text}
              </div>
            )}
            {documents.isLoading ? (
              <LoadingRows rows={4} />
            ) : filteredDocs.length === 0 ? (
              <EmptyState title="没有匹配的文档" />
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-muted-foreground)]">
                    <th className="py-2 font-medium">名称</th>
                    <th className="py-2 font-medium">版本</th>
                    <th className="py-2 font-medium">分块数</th>
                    <th className="py-2 font-medium">状态</th>
                    <th className="py-2 font-medium">更新时间 / 操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc) => (
                    <tr
                      key={doc.source_id}
                      onClick={() => setSelectedDoc(doc)}
                      className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]"
                    >
                      <td className="py-2 font-technical text-[var(--color-foreground)]">
                        {doc.source_id}
                      </td>
                      <td className="py-2 font-technical text-[var(--color-muted-foreground)]">
                        v{doc.version}
                      </td>
                      <td className="py-2 font-technical text-[var(--color-muted-foreground)]">
                        {doc.chunk_count ?? "—"}
                      </td>
                      <td className="py-2">
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="py-2 text-[var(--color-subtle-foreground)]">
                        <div className="flex items-center justify-between gap-2">
                          <span>{formatRelativeTime(doc.last_synced_at)}</span>
                          {doc.source_type === "filesystem" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[var(--color-error)] hover:bg-[var(--color-error-muted)] hover:text-[var(--color-error)]"
                              disabled={!canManageLocalFiles || remove.isPending || upload.isPending}
                              aria-label={`删除 ${doc.source_id}`}
                              title={canManageLocalFiles ? `删除 ${doc.source_id}` : "需要操作员权限"}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (window.confirm(`确定删除“${doc.source_id}”吗？删除后相关索引也会被清理。`)) {
                                  setFeedback(null)
                                  remove.mutate(doc.source_id)
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {selectedDoc && <DocumentDetail doc={selectedDoc} onClose={() => setSelectedDoc(null)} />}
    </div>
  )
}
