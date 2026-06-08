import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const securityRoute = apiClient.api.admin.security
const loginEventsRoute = securityRoute['login-events']
const sessionsRoute = securityRoute.sessions

type ListLoginEventsResponse = InferResponseType<
  typeof loginEventsRoute.$get,
  200
>
type ListActiveSessionsResponse = InferResponseType<
  typeof sessionsRoute.$get,
  200
>

export type LoginEventStatus = 'success' | 'failure'
export type LoginEventListItem = ListLoginEventsResponse['items'][number]
export type ActiveSessionListItem = ListActiveSessionsResponse['items'][number]

export type LoginEventsQuery = {
  limit?: number
  page?: number
  search?: string
  status?: LoginEventStatus
}

export type ActiveSessionsQuery = {
  limit?: number
  page?: number
  search?: string
}

export const defaultSecurityPageLimit = 20

export const loginStatusLabels: Record<LoginEventStatus, string> = {
  success: 'Sucesso',
  failure: 'Falha',
}

export const loginStatusOptions = (
  Object.keys(loginStatusLabels) as LoginEventStatus[]
).map((value) => ({ value, label: loginStatusLabels[value] }))

// Monta um rotulo de localidade a partir de cidade/regiao/pais.
export function formatLocation(parts: {
  city?: string | null
  region?: string | null
  country?: string | null
}) {
  const segments = [parts.city, parts.region, parts.country].filter(
    (value): value is string => !!value && value.trim() !== '',
  )

  return segments.length > 0 ? segments.join(', ') : null
}

export async function fetchLoginEvents(query: LoginEventsQuery) {
  const trimmedSearch = query.search?.trim() ?? ''
  const response = await loginEventsRoute.$get({
    query: {
      limit: String(query.limit ?? defaultSecurityPageLimit),
      page: String(query.page ?? 1),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar o historico de logins.',
      ),
    )
  }

  return (await response.json()) as ListLoginEventsResponse
}

export async function fetchActiveSessions(query: ActiveSessionsQuery) {
  const trimmedSearch = query.search?.trim() ?? ''
  const response = await sessionsRoute.$get({
    query: {
      limit: String(query.limit ?? defaultSecurityPageLimit),
      page: String(query.page ?? 1),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as sessoes ativas.',
      ),
    )
  }

  return (await response.json()) as ListActiveSessionsResponse
}

export async function revokeSessionRequest(sessionId: string) {
  const response = await sessionsRoute[':sessionId'].$delete({
    param: { sessionId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel revogar a sessao.'),
    )
  }

  return await response.json()
}
