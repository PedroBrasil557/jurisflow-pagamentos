import { queryOptions } from '@tanstack/react-query'
import { getSession } from './auth-session'

export const sessionKeys = {
  all: ['auth-session'] as const,
  session: () => [...sessionKeys.all, 'session'] as const,
}

export function sessionOptions() {
  return queryOptions({
    queryKey: sessionKeys.session(),
    queryFn: async () => {
      const result = await getSession()
      if (!result) {
        throw new Error('Sessao expirada.')
      }
      return result
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
