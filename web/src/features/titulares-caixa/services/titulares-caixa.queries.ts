import { queryOptions } from '@tanstack/react-query'
import {
  fetchEmpreendimentoOptions,
  fetchTitulares,
  type TitularesListQuery,
} from './titulares-caixa.service'

export const titularKeys = {
  all: ['titulares-caixa'] as const,
  lists: () => [...titularKeys.all, 'list'] as const,
  list: (query: TitularesListQuery) =>
    [...titularKeys.lists(), query] as const,
  empreendimentoOptions: () =>
    [...titularKeys.all, 'empreendimento-options'] as const,
}

export function empreendimentoOptionsQuery() {
  return queryOptions({
    queryKey: titularKeys.empreendimentoOptions(),
    queryFn: fetchEmpreendimentoOptions,
    staleTime: 5 * 60 * 1000,
  })
}

export function titularListOptions(query: TitularesListQuery) {
  return queryOptions({
    queryKey: titularKeys.list(query),
    queryFn: () => fetchTitulares(query),
    // Enquanto houver titular com consulta pendente, repete para acompanhar o
    // avanco da fila RPA sem recarregar.
    refetchInterval: (result) =>
      result.state.data?.items.some((item) => item.quitacaoStatus === 'pending')
        ? 3000
        : false,
  })
}
