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

export type HousingComplexPayload = {
  name: string
  district: string
  city: string
  state: string
  zipcode: string
  vara: string
  causeValue: string
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

export async function createHousingComplexRequest(
  payload: HousingComplexPayload,
) {
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
  payload: HousingComplexPayload
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

// --- Documentos do conjunto ---

const housingComplexDocumentsRoute =
  adminHousingComplexesRoute[':housingComplexId'].documents

type HousingComplexFilesResponse = InferResponseType<
  typeof housingComplexDocumentsRoute.$get,
  200
>

export type HousingComplexFile = HousingComplexFilesResponse['items'][number]

export async function fetchHousingComplexFiles(housingComplexId: string) {
  const response = await housingComplexDocumentsRoute.$get({
    param: { housingComplexId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os documentos do conjunto.',
      ),
    )
  }

  return (await response.json()) as HousingComplexFilesResponse
}

export async function uploadHousingComplexFileRequest(input: {
  housingComplexId: string
  documentTypeKey: string
  file: File
}) {
  const url = housingComplexDocumentsRoute[':documentTypeKey'].$url({
    param: {
      housingComplexId: input.housingComplexId,
      documentTypeKey: input.documentTypeKey,
    },
  })

  const formData = new FormData()
  formData.append('file', input.file)

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel anexar o documento.'),
    )
  }

  return await response.json()
}

export async function deleteHousingComplexFileRequest(input: {
  housingComplexId: string
  fileId: string
}) {
  const response = await housingComplexDocumentsRoute[':fileId'].$delete({
    param: {
      housingComplexId: input.housingComplexId,
      fileId: input.fileId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel remover o documento.'),
    )
  }

  return await response.json()
}
