import { displayLabel } from "@/lib/labels"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Database, FileText } from "lucide-react"
import { useState } from "react"

import { classifyError } from "@/api/client"
import { sourcesApi } from "@/api/sources"
import type { DocumentRecord } from "@/api/types"
import { EmptyState } from "@/components/EmptyState"
import { ErrorState } from "@/components/ErrorState"
import { LoadingRows } from "@/components/LoadingSkeleton"
import { StatusBadge } from "@/components/StatusBadge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [selectedSourceType, setSelectedSourceType] = useState<string | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null)
  const [search, setSearch] = useState("")

  const sources = useQuery({ queryKey: ["sources"], queryFn: sourcesApi.list })
  const documents = useQuery({
    queryKey: ["documents", selectedSourceType],
    queryFn: () => sourcesApi.documents(selectedSourceType ?? undefined),
    enabled: Boolean(selectedSourceType),
  })

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
            <input
              placeholder="按名称筛选…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-[var(--color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            />
          </CardHeader>
          <CardContent>
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
                    <th className="py-2 font-medium">更新时间</th>
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
                        {formatRelativeTime(doc.last_synced_at)}
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
