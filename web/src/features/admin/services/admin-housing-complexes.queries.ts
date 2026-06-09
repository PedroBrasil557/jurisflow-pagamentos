import { queryOptions } from '@tanstack/react-query'
import {
  fetchAdminHousingComplexes,
  fetchHousingComplexFiles,
  type HousingComplexListQuery,
} from './admin-housing-complexes.service'

export const adminHousingComplexKeys = {
  all: ['admin-housing-complexes'] as const,
  lists: () => [...adminHousingComplexKeys.all, 'list'] as const,
  list: (query: HousingComplexListQuery) =>
    [...adminHousingComplexKeys.lists(), query] as const,
  documents: (housingComplexId: string) =>
    [...adminHousingComplexKeys.all, 'documents', housingComplexId] as const,
}

export function adminHousingComplexListOptions(query: HousingComplexListQuery) {
  return queryOptions({
    queryKey: adminHousingComplexKeys.list(query),
    queryFn: () => fetchAdminHousingComplexes(query),
  })
}

export function housingComplexFilesOptions(housingComplexId: string) {
  return queryOptions({
    queryKey: adminHousingComplexKeys.documents(housingComplexId),
    queryFn: () => fetchHousingComplexFiles(housingComplexId),
  })
}
