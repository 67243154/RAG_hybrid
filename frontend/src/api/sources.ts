import { api } from "@/api/client"
import type { DocumentRecord, FileMutationResult, SourceSummary } from "@/api/types"

export const sourcesApi = {
  list: () => api.get<SourceSummary[]>("/sources"),
  documents: (sourceType?: string) =>
    api.get<DocumentRecord[]>(
      sourceType ? `/ui/documents?source_type=${encodeURIComponent(sourceType)}` : "/ui/documents",
    ),
  upload: (file: File) => {
    const body = new FormData()
    body.append("file", file)
    return api.postForm<FileMutationResult>("/files", body)
  },
  remove: (sourceId: string) =>
    api.delete<FileMutationResult>(`/files/${encodeURIComponent(sourceId)}`),
}
