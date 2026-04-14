import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminUserKeys } from '@/features/admin/services/admin-users.queries'
import { sessionKeys } from '@/features/auth/services/auth-session.queries'
import { profileKeys } from './permissions.queries'
import {
  assignProfileToUserRequest,
  createProfileRequest,
  deleteProfileRequest,
  updateProfileRequest,
  updateUserHousingComplexesRequest,
} from './permissions.service'

export function useCreateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createProfileRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() })
    },
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateProfileRequest,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: profileKeys.detail(variables.profileId),
      })
      queryClient.invalidateQueries({ queryKey: sessionKeys.session() })
    },
  })
}

export function useDeleteProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteProfileRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() })
      queryClient.invalidateQueries({ queryKey: sessionKeys.session() })
    },
  })
}

export function useAssignProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: assignProfileToUserRequest,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: profileKeys.lists() })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: profileKeys.userHousingComplexes(variables.userId),
      })
      queryClient.invalidateQueries({ queryKey: sessionKeys.session() })
    },
  })
}

export function useUpdateUserHousingComplexes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateUserHousingComplexesRequest,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: profileKeys.userHousingComplexes(variables.userId),
      })
      queryClient.invalidateQueries({ queryKey: sessionKeys.session() })
    },
  })
}
