import { useMutation, useQueryClient } from '@tanstack/react-query'
import { titularKeys } from './titulares-caixa.queries'
import {
  bulkLinkConjuntoRequest,
  importTitularesRequest,
  reconsultarTitularesRequest,
  type TitularesFilter,
  upsertTerceiroRequest,
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
    mutationFn: (payload: { ids?: string[]; filter?: TitularesFilter }) =>
      reconsultarTitularesRequest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: titularKeys.lists() })
    },
  })
}

export function useUpsertTerceiro() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: upsertTerceiroRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: titularKeys.lists() })
    },
  })
}

export function useBulkLinkConjunto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkLinkConjuntoRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: titularKeys.lists() })
      queryClient.invalidateQueries({ queryKey: titularKeys.conjuntoOptions() })
    },
  })
}
