import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

export type HousingComplexOption = {
  id: string
  name: string
  district: string | null
  city: string | null
  state: string | null
  zipcode: string | null
}

export type HousingComplexOptionsQuery = {
  search?: string
  ids?: string[]
  limit?: number
  page?: number
}

export type HousingComplexOptionsResponse = {
  items: HousingComplexOption[]
  page: number
  pageSize: number
  total: number
}

export async function fetchHousingComplexOptions(
  query: HousingComplexOptionsQuery = {},
): Promise<HousingComplexOptionsResponse> {
  const response = await apiClient.api['housing-complexes'].$get({
    query: {
      ...(query.search ? { search: query.search } : {}),
      ...(query.ids?.length ? { ids: query.ids } : {}),
      limit: String(query.limit ?? 20),
      page: String(query.page ?? 1),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os conjuntos.',
      ),
    )
  }

  return (await response.json()) as HousingComplexOptionsResponse
}
