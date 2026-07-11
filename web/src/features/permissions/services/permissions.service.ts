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
  cadastros: {
    usuarios: boolean
    conjuntos: boolean
    permissoes: boolean
  }
}

export type TitularMunicipio = { uf: string; municipio: string }

export type ResolvedPermissions = {
  isAdmin: boolean
  /** Administrador master (bypass total). Admin comum segue o perfil em titularCaixa. */
  isMaster: boolean
  processScope: ProcessScope
  allowedHousingComplexIds: string[]
  /** UFs liberadas ao usuário para Titular Caixa (aditivo aos conjuntos) */
  allowedUfs: string[]
  /** Municípios liberados (par uf+município) para Titular Caixa */
  allowedMunicipios: TitularMunicipio[]
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

// --- Grants geográficos do usuário (Titular Caixa): UF e município ---

export async function fetchUserTitularUfs(userId: string): Promise<string[]> {
  const response = await apiClient.api.admin.users[':userId'][
    'titular-ufs'
  ].$get({ param: { userId } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os estados do usuario.',
      ),
    )
  }

  const data = (await response.json()) as { items: { uf: string }[] }
  return data.items.map((item) => item.uf)
}

export async function updateUserTitularUfsRequest(input: {
  userId: string
  ufs: string[]
}) {
  const response = await apiClient.api.admin.users[':userId'][
    'titular-ufs'
  ].$put({
    param: { userId: input.userId },
    json: { ufs: input.ufs },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel atualizar os estados do usuario.',
      ),
    )
  }

  return await response.json()
}

export async function fetchUserTitularMunicipios(
  userId: string,
): Promise<TitularMunicipio[]> {
  const response = await apiClient.api.admin.users[':userId'][
    'titular-municipios'
  ].$get({ param: { userId } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as cidades do usuario.',
      ),
    )
  }

  const data = (await response.json()) as { items: TitularMunicipio[] }
  return data.items
}

export async function updateUserTitularMunicipiosRequest(input: {
  userId: string
  municipios: TitularMunicipio[]
}) {
  const response = await apiClient.api.admin.users[':userId'][
    'titular-municipios'
  ].$put({
    param: { userId: input.userId },
    json: { municipios: input.municipios },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel atualizar as cidades do usuario.',
      ),
    )
  }

  return await response.json()
}

export async function fetchTitularLocalidades(): Promise<{
  ufs: string[]
  municipios: TitularMunicipio[]
}> {
  const response = await apiClient.api.admin.users['titular-localidades'].$get()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as localidades.',
      ),
    )
  }

  return (await response.json()) as {
    ufs: string[]
    municipios: TitularMunicipio[]
  }
}
