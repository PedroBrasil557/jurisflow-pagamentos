import type { AppType } from '@api/app'
import { hc } from 'hono/client'
import { clientEnv } from '@/shared/config/client-env'

export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl, {
    init: {
      credentials: 'include',
    },
  })
}

export const apiClient = createApiClient(clientEnv.apiUrl)
