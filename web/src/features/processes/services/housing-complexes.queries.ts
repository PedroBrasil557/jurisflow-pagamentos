import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { fetchHousingComplexOptions } from './housing-complexes.service'

const PAGE_SIZE = 20

export const housingComplexOptionKeys = {
  all: ['housing-complex-options'] as const,
  list: (search: string) => [...housingComplexOptionKeys.all, search] as const,
  byIds: (ids: string[]) =>
    [...housingComplexOptionKeys.all, 'by-ids', [...ids].sort()] as const,
}

export function housingComplexOptionsInfiniteQuery(search: string) {
  return infiniteQueryOptions({
    queryKey: housingComplexOptionKeys.list(search),
    queryFn: ({ pageParam }) =>
      fetchHousingComplexOptions({
        search: search || undefined,
        limit: PAGE_SIZE,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const totalPages = Math.ceil(lastPage.total / lastPage.pageSize)
      return lastPage.page < totalPages ? lastPage.page + 1 : undefined
    },
  })
}

// Resolve nomes dos conjuntos selecionados pelo filtro (a partir dos IDs da URL),
// para renderizar os chips mesmo quando nao estao na pagina atual de opcoes.
export function housingComplexOptionsByIdsQuery(ids: string[]) {
  return queryOptions({
    queryKey: housingComplexOptionKeys.byIds(ids),
    queryFn: () => fetchHousingComplexOptions({ ids, limit: ids.length || 1 }),
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}
