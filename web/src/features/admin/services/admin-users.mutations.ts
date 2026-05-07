import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionKeys } from '@/features/auth/services/auth-session.queries'
import { adminUserKeys } from './admin-users.queries'
import {
  createAdminUserRequest,
  resetUserAccountRequest,
  updateAdminUserRequest,
} from './admin-users.service'

export function useCreateAdminUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createAdminUserRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
    },
  })
}

export function useUpdateAdminUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateAdminUserRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
      queryClient.invalidateQueries({ queryKey: sessionKeys.session() })
    },
  })
}

export function useResetUserAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: resetUserAccountRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
    },
  })
}
