import { queryOptions } from '@tanstack/react-query'
import {
  fetchConjuntoOptions,
  fetchEmpreendimentoOptions,
  fetchLogradouroOptions,
  fetchTitularDocumentPreviewUrl,
  fetchTitulares,
  type TitularesListQuery,
} from './titulares-caixa.service'

export const titularKeys = {
  all: ['titulares-caixa'] as const,
  lists: () => [...titularKeys.all, 'list'] as const,
  list: (query: TitularesListQuery) => [...titularKeys.lists(), query] as const,
  empreendimentoOptions: () =>
    [...titularKeys.all, 'empreendimento-options'] as const,
  conjuntoOptions: () => [...titularKeys.all, 'conjunto-options'] as const,
  logradouroOptions: () => [...titularKeys.all, 'logradouro-options'] as const,
  documentPreviewUrl: (titularId: string, docId: string) =>
    [...titularKeys.all, 'document-preview-url', titularId, docId] as const,
}

export function empreendimentoOptionsQuery() {
  return queryOptions({
    queryKey: titularKeys.empreendimentoOptions(),
    queryFn: fetchEmpreendimentoOptions,
    staleTime: 5 * 60 * 1000,
  })
}

export function conjuntoOptionsQuery() {
  return queryOptions({
    queryKey: titularKeys.conjuntoOptions(),
    queryFn: fetchConjuntoOptions,
    staleTime: 5 * 60 * 1000,
  })
}

export function logradouroOptionsQuery() {
  return queryOptions({
    queryKey: titularKeys.logradouroOptions(),
    queryFn: fetchLogradouroOptions,
    staleTime: 5 * 60 * 1000,
  })
}

export function titularDocumentPreviewUrlQuery(
  titularId: string,
  docId: string,
) {
  return queryOptions({
    queryKey: titularKeys.documentPreviewUrl(titularId, docId),
    queryFn: () => fetchTitularDocumentPreviewUrl(titularId, docId),
    // URL pre-assinada expira (10 min) — nao reaproveitar entre aberturas.
    staleTime: 0,
    gcTime: 0,
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
