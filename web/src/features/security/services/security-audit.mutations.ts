import { useMutation, useQueryClient } from '@tanstack/react-query'
import { securityKeys } from './security-audit.queries'
import { revokeSessionRequest } from './security-audit.service'

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revokeSessionRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: securityKeys.sessionsLists() })
    },
  })
}
