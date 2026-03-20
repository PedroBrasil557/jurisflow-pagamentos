import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { ProcessListQuery } from './processes.service'
import {
  fetchProcess,
  fetchProcessChecklist,
  fetchProcesses,
  fetchProcessHistory,
  fetchUserOptions,
  getProcessPdfModelsRequest,
  mapProcessToDraft,
} from './processes.service'

export const processKeys = {
  all: ['processes'] as const,
  lists: () => [...processKeys.all, 'list'] as const,
  list: (query: ProcessListQuery) => [...processKeys.lists(), query] as const,
  details: () => [...processKeys.all, 'detail'] as const,
  detail: (id: string) => [...processKeys.details(), id] as const,
  checklist: (id: string) => [...processKeys.all, 'checklist', id] as const,
  pdfModels: (id: string) => [...processKeys.all, 'pdf-models', id] as const,
  history: (id: string) => [...processKeys.all, 'history', id] as const,
  userOptions: (search: string) => ['user-options', search] as const,
}

export function processListOptions(query: ProcessListQuery) {
  return queryOptions({
    queryKey: processKeys.list(query),
    queryFn: () => fetchProcesses(query),
  })
}

export function processDetailOptions(processId: string) {
  return queryOptions({
    queryKey: processKeys.detail(processId),
    queryFn: async () => {
      const result = await fetchProcess(processId)
      return {
        process: result.process,
        draft: mapProcessToDraft(result.process),
      }
    },
  })
}

export function processChecklistOptions(processId: string) {
  return queryOptions({
    queryKey: processKeys.checklist(processId),
    queryFn: () => fetchProcessChecklist(processId),
  })
}

const USER_OPTIONS_PAGE_SIZE = 20

export function userOptionsInfiniteQuery(search: string) {
  return infiniteQueryOptions({
    queryKey: processKeys.userOptions(search),
    queryFn: ({ pageParam }) =>
      fetchUserOptions({
        search: search || undefined,
        limit: USER_OPTIONS_PAGE_SIZE,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const totalPages = Math.ceil(lastPage.total / lastPage.pageSize)
      return lastPage.page < totalPages ? lastPage.page + 1 : undefined
    },
  })
}

export function processHistoryOptions(processId: string) {
  return infiniteQueryOptions({
    queryKey: processKeys.history(processId),
    queryFn: ({ pageParam }) =>
      fetchProcessHistory(processId, {
        cursor: pageParam ?? undefined,
        limit: 20,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!processId,
  })
}

export function pdfModelsOptions(processId: string) {
  return queryOptions({
    queryKey: processKeys.pdfModels(processId),
    queryFn: () => getProcessPdfModelsRequest(processId),
  })
}
