import { useMutation, useQueryClient } from '@tanstack/react-query'
import { housingComplexOptionKeys } from '@/features/processes/services/housing-complexes.queries'
import { adminHousingComplexKeys } from './admin-housing-complexes.queries'
import {
  createHousingComplexRequest,
  deleteHousingComplexFileRequest,
  deleteHousingComplexRequest,
  updateHousingComplexRequest,
  uploadHousingComplexFileRequest,
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

export function useUploadHousingComplexFile(housingComplexId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { documentTypeKey: string; file: File }) =>
      uploadHousingComplexFileRequest({ housingComplexId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adminHousingComplexKeys.documents(housingComplexId),
      })
    },
  })
}

export function useDeleteHousingComplexFile(housingComplexId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) =>
      deleteHousingComplexFileRequest({ housingComplexId, fileId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: adminHousingComplexKeys.documents(housingComplexId),
      })
    },
  })
}
