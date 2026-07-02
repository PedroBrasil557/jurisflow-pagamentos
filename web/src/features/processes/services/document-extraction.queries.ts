import { queryOptions } from '@tanstack/react-query'
import {
  fetchDocumentExtractionDetail,
  fetchDocumentExtractions,
} from './document-extraction.service'

export const documentExtractionKeys = {
  all: ['document-extraction'] as const,
  list: (processId: string) =>
    [...documentExtractionKeys.all, 'list', processId] as const,
  detail: (processId: string, id: string) =>
    [...documentExtractionKeys.all, 'detail', processId, id] as const,
}

export function documentExtractionListOptions(processId: string) {
  return queryOptions({
    queryKey: documentExtractionKeys.list(processId),
    queryFn: () => fetchDocumentExtractions(processId),
  })
}

export function documentExtractionDetailOptions(processId: string, id: string) {
  return queryOptions({
    queryKey: documentExtractionKeys.detail(processId, id),
    queryFn: () => fetchDocumentExtractionDetail(processId, id),
  })
}
