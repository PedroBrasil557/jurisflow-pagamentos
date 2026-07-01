import { useMutation, useQueryClient } from '@tanstack/react-query'
import { titularKeys } from './titulares-caixa.queries'
import {
  importTitularesRequest,
  reconsultarTitularesRequest,
} from './titulares-caixa.service'

export function useImportTitulares() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => importTitularesRequest(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: titularKeys.lists() })
    },
  })
}

export function useReconsultarTitulares() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => reconsultarTitularesRequest(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: titularKeys.lists() })
    },
  })
}
