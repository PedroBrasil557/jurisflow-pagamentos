import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const adminHousingComplexesRoute = apiClient.api.admin['housing-complexes']

type ListHousingComplexesResponse = InferResponseType<
  typeof adminHousingComplexesRoute.$get,
  200
>
type CreateHousingComplexResponse = InferResponseType<
  typeof adminHousingComplexesRoute.$post,
  201
>

export type HousingComplexListItem =
  ListHousingComplexesResponse['items'][number]
export type HousingComplexListQuery = {
  limit?: number
  page?: number
  search?: string
}

export const defaultHousingComplexPageLimit = 10

export async function fetchAdminHousingComplexes(
  query: HousingComplexListQuery,
) {
  const trimmedSearch = query.search?.trim() ?? ''
  const response = await adminHousingComplexesRoute.$get({
    query: {
      limit: String(query.limit ?? defaultHousingComplexPageLimit),
      page: String(query.page ?? 1),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
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

  return (await response.json()) as ListHousingComplexesResponse
}

export async function createHousingComplexRequest(payload: { name: string }) {
  const response = await adminHousingComplexesRoute.$post({
    json: payload,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel criar o conjunto.'),
    )
  }

  return (await response.json()) as CreateHousingComplexResponse
}

export async function updateHousingComplexRequest(input: {
  housingComplexId: string
  payload: { name: string }
}) {
  const response = await adminHousingComplexesRoute[':housingComplexId'].$patch(
    {
      param: { housingComplexId: input.housingComplexId },
      json: input.payload,
    },
  )

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel atualizar o conjunto.'),
    )
  }

  return await response.json()
}

export async function deleteHousingComplexRequest(housingComplexId: string) {
  const response = await adminHousingComplexesRoute[
    ':housingComplexId'
  ].$delete({
    param: { housingComplexId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel excluir o conjunto.'),
    )
  }

  return await response.json()
}
