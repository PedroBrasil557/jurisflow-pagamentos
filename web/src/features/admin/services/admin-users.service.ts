import type { InferRequestType, InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'
import type { AdminUserFormPayload } from '../schemas/admin-user-form.schema'

const adminUsersClientRoute = apiClient.api.admin.users

type ListAdminUsersResponse = InferResponseType<
  typeof adminUsersClientRoute.$get,
  200
>
type CreateAdminUserResponse = InferResponseType<
  typeof adminUsersClientRoute.$post,
  201
>
type CreateAdminUserRequest = InferRequestType<
  typeof adminUsersClientRoute.$post
>['json']

export type AdminUsersPageData = ListAdminUsersResponse
export type AdminUserListItem = ListAdminUsersResponse['items'][number]
export type AdminUserListQuery = {
  limit?: number
  page?: number
  search?: string
}

export type ResetUserAccountResponse = {
  message: string
  temporaryPassword: string
  user: { id: string; name: string }
}

export const defaultAdminUsersPageLimit = 10

export async function fetchAdminUsers(query: AdminUserListQuery) {
  const trimmedSearch = query.search?.trim() ?? ''
  const response = await adminUsersClientRoute.$get({
    query: {
      limit: String(query.limit ?? defaultAdminUsersPageLimit),
      page: String(query.page ?? 1),
      ...(trimmedSearch
        ? {
            search: trimmedSearch,
          }
        : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os usuarios administrativos.',
      ),
    )
  }

  return (await response.json()) as ListAdminUsersResponse
}

function toAdminUserPayload(
  values: AdminUserFormPayload,
): CreateAdminUserRequest {
  return {
    cpf: values.cpf,
    email: values.email || undefined,
    isAdmin: values.isAdmin,
    name: values.name,
    profileId: values.isAdmin ? undefined : values.profileId || undefined,
  }
}

export async function createAdminUserRequest(values: AdminUserFormPayload) {
  const response = await adminUsersClientRoute.$post({
    json: toAdminUserPayload(values),
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel criar o usuario.'),
    )
  }

  return (await response.json()) as CreateAdminUserResponse
}

export async function updateAdminUserRequest(input: {
  userId: string
  payload: { email?: string; isAdmin: boolean; name: string }
}) {
  const response = await apiClient.api.admin.users[':userId'].$patch({
    param: { userId: input.userId },
    json: input.payload,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel atualizar o usuario.'),
    )
  }

  return await response.json()
}

export async function resetUserAccountRequest(
  userId: string,
): Promise<ResetUserAccountResponse> {
  const response = await apiClient.api.admin.users[':userId'].reset.$post({
    param: { userId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel resetar a conta do usuario.',
      ),
    )
  }

  return (await response.json()) as ResetUserAccountResponse
}
