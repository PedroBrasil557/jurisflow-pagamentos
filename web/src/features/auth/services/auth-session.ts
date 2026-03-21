import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'

type SessionResponse = InferResponseType<typeof apiClient.api.session.$get, 200>

export async function getSession(): Promise<SessionResponse | null> {
  const response = await apiClient.api.session.$get()

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error('Failed to fetch auth session from API.')
  }

  return (await response.json()) as SessionResponse
}
