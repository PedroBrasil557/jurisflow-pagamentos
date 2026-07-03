import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

// ---------------------------------------------------------------------------
// Types inferred from API responses
// ---------------------------------------------------------------------------

export type ProcessScope = 'own' | 'housing_complex' | 'all'

export type ProfilePermissions = {
  process: {
    create: boolean
    viewOwn: boolean
    editOwn: boolean
    editAny: boolean
    startLegal: boolean
    editLegal: boolean
    finalize: boolean
    cancelOwn: boolean
    cancelAny: boolean
    markDocumentationReady: boolean
    uploadChecklist: boolean
    deleteChecklistFile: boolean
    viewBatch: boolean
    uploadBatch: boolean
    deleteBatch: boolean
    generatePdf: boolean
  }
  sections: {
    dashboard: boolean
    checklist: boolean
    documentation: boolean
    legalData: boolean
    history: boolean
    batch: boolean
  }
  titularCaixa: {
    view: boolean
    export: boolean
    import: boolean
    reconsultar: boolean
  }
}

export type ResolvedPermissions = {
  isAdmin: boolean
  processScope: ProcessScope
  allowedHousingComplexIds: string[]
  permissions: ProfilePermissions
  profileId: string | null
  profileName: string | null
}

export type ProfileListItem = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  processScope: ProcessScope
  userCount: number
  housingComplexes: { id: string; name: string }[]
  createdAt: string
  updatedAt: string
}

export type ProfilesPageData = {
  items: ProfileListItem[]
  page: number
  pageSize: number
  total: number
}

export type ProfileDetail = ProfileListItem & {
  permissions: ProfilePermissions
  users: {
    id: string
    name: string
    username: string | null
    isActive: boolean
    assignedAt: string
  }[]
}

export type ProfileListQuery = {
  search?: string
  page?: number
  limit?: number
}

export type CreateProfilePayload = {
  name: string
  description?: string
  processScope: ProcessScope
  permissions: ProfilePermissions
  housingComplexIds: string[]
}

export type UpdateProfilePayload = CreateProfilePayload

export type UserHousingComplex = {
  id: string
  name: string
  grantedAt: string
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function fetchProfiles(query: ProfileListQuery) {
  const response = await apiClient.api.admin.profiles.$get({
    query: {
      ...(query.search ? { search: query.search } : {}),
      page: String(query.page ?? 1),
      limit: String(query.limit ?? 20),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel carregar os perfis.'),
    )
  }

  return (await response.json()) as ProfilesPageData
}

export async function fetchProfileDetail(profileId: string) {
  const response = await apiClient.api.admin.profiles[':profileId'].$get({
    param: { profileId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel carregar o perfil.'),
    )
  }

  const data = await response.json()
  return (data as { profile: ProfileDetail }).profile
}

export async function createProfileRequest(payload: CreateProfilePayload) {
  const response = await apiClient.api.admin.profiles.$post({
    json: payload,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel criar o perfil.'),
    )
  }

  return await response.json()
}

export async function updateProfileRequest(input: {
  profileId: string
  payload: UpdateProfilePayload
}) {
  const response = await apiClient.api.admin.profiles[':profileId'].$patch({
    param: { profileId: input.profileId },
    json: input.payload,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel atualizar o perfil.'),
    )
  }

  return await response.json()
}

export async function deleteProfileRequest(profileId: string) {
  const response = await apiClient.api.admin.profiles[':profileId'].$delete({
    param: { profileId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel excluir o perfil.'),
    )
  }

  return await response.json()
}

export async function assignProfileToUserRequest(input: {
  userId: string
  profileId: string
}) {
  const response = await apiClient.api.admin.users[':userId'].profile.$put({
    param: { userId: input.userId },
    json: { profileId: input.profileId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel atribuir o perfil.'),
    )
  }

  return await response.json()
}

export async function fetchUserHousingComplexes(userId: string) {
  const response = await apiClient.api.admin.users[':userId'][
    'housing-complexes'
  ].$get({
    param: { userId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os conjuntos do usuario.',
      ),
    )
  }

  const data = await response.json()
  return (data as { items: UserHousingComplex[] }).items
}

export async function updateUserHousingComplexesRequest(input: {
  userId: string
  housingComplexIds: string[]
}) {
  const response = await apiClient.api.admin.users[':userId'][
    'housing-complexes'
  ].$put({
    param: { userId: input.userId },
    json: { housingComplexIds: input.housingComplexIds },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel atualizar os conjuntos do usuario.',
      ),
    )
  }

  return await response.json()
}
