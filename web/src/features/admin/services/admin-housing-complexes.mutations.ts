import { useMutation, useQueryClient } from '@tanstack/react-query'
import { housingComplexOptionKeys } from '@/features/processes/services/housing-complexes.queries'
import { adminHousingComplexKeys } from './admin-housing-complexes.queries'
import {
  createHousingComplexRequest,
  deleteHousingComplexRequest,
  updateHousingComplexRequest,
} from './admin-housing-complexes.service'

export function useCreateHousingComplex() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createHousingComplexRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adminHousingComplexKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: housingComplexOptionKeys.all,
      })
    },
  })
}

export function useUpdateHousingComplex() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateHousingComplexRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adminHousingComplexKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: housingComplexOptionKeys.all,
      })
    },
  })
}

export function useDeleteHousingComplex() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteHousingComplexRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adminHousingComplexKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: housingComplexOptionKeys.all,
      })
    },
  })
}
