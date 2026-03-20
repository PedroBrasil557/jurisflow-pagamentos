import { infiniteQueryOptions } from '@tanstack/react-query'
import { fetchHousingComplexOptions } from './housing-complexes.service'

const PAGE_SIZE = 20

export const housingComplexOptionKeys = {
  all: ['housing-complex-options'] as const,
  list: (search: string) => [...housingComplexOptionKeys.all, search] as const,
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
