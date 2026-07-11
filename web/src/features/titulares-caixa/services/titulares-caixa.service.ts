import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const titularesRoute = apiClient.api['titulares-caixa']
const titularDocumentoRoute = titularesRoute[':id'].documentos[':docId']

export const titularQuitacaoStatuses = [
  'idle',
  'pending',
  'quitado',
  'nao_encontrado',
  'erro',
] as const
export type TitularQuitacaoStatus = (typeof titularQuitacaoStatuses)[number]

export const titularQuitacaoStatusLabels: Record<
  TitularQuitacaoStatus,
  string
> = {
  idle: 'Sem consulta',
  pending: 'Pendente',
  quitado: 'Quitado',
  nao_encontrado: 'Nao encontrado',
  erro: 'Erro',
}

export const titularAverbacaoValues = ['sim', 'nao', 'indeterminado'] as const
export type TitularAverbacao = (typeof titularAverbacaoValues)[number]

export const titularAverbacaoLabels: Record<TitularAverbacao, string> = {
  sim: 'Sim',
  nao: 'Nao',
  indeterminado: 'Indeterminado',
}

export type TitularesListQuery = {
  page?: number
  limit?: number
  search?: string
  uf?: string[]
  municipio?: string
  modalidade?: string[]
  empreendimento?: string[]
  conjuntoIds?: string[]
  logradouros?: string[]
  quitacaoStatuses?: TitularQuitacaoStatus[]
  averbacoes?: TitularAverbacao[]
  assinaturaFrom?: string
  assinaturaTo?: string
}

export type ConjuntoOption = { id: string; nome: string }

type ListTitularesResponse = InferResponseType<typeof titularesRoute.$get, 200>
export type TitularListItem = ListTitularesResponse['items'][number]

export type ImportTitularesResponse = InferResponseType<
  typeof titularesRoute.import.$post,
  200
>

export const defaultTitularesPageLimit = 20

export async function fetchTitulares(
  query: TitularesListQuery,
): Promise<ListTitularesResponse> {
  const response = await titularesRoute.$get({
    query: {
      limit: String(query.limit ?? defaultTitularesPageLimit),
      page: String(query.page ?? 1),
      ...(query.search ? { search: query.search } : {}),
      ...(query.uf?.length ? { uf: query.uf } : {}),
      ...(query.municipio ? { municipio: query.municipio } : {}),
      ...(query.modalidade?.length ? { modalidade: query.modalidade } : {}),
      ...(query.empreendimento?.length
        ? { empreendimento: query.empreendimento }
        : {}),
      ...(query.conjuntoIds?.length ? { conjuntoIds: query.conjuntoIds } : {}),
      ...(query.logradouros?.length ? { logradouros: query.logradouros } : {}),
      ...(query.quitacaoStatuses?.length
        ? { quitacaoStatuses: query.quitacaoStatuses }
        : {}),
      ...(query.averbacoes?.length ? { averbacoes: query.averbacoes } : {}),
      ...(query.assinaturaFrom ? { assinaturaFrom: query.assinaturaFrom } : {}),
      ...(query.assinaturaTo ? { assinaturaTo: query.assinaturaTo } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os titulares.',
      ),
    )
  }

  return (await response.json()) as ListTitularesResponse
}

export async function importTitularesRequest(
  file: File,
): Promise<ImportTitularesResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(titularesRoute.import.$url(), {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel importar a planilha.'),
    )
  }

  return (await response.json()) as ImportTitularesResponse
}

export async function fetchEmpreendimentoOptions(): Promise<string[]> {
  const response = await titularesRoute.opcoes.empreendimento.$get()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os empreendimentos.',
      ),
    )
  }

  const body = (await response.json()) as { options: string[] }
  return body.options
}

export async function fetchLogradouroOptions(): Promise<string[]> {
  const response = await titularesRoute.opcoes.logradouro.$get()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os logradouros.',
      ),
    )
  }

  const body = (await response.json()) as { options: string[] }
  return body.options
}

export async function fetchConjuntoOptions(): Promise<ConjuntoOption[]> {
  const response = await titularesRoute.opcoes.conjunto.$get()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os conjuntos.',
      ),
    )
  }

  const body = (await response.json()) as { options: ConjuntoOption[] }
  return body.options
}

// URL do export .xlsx com os filtros atuais (sem page/limit). Same-origin →
// abrir num anchor dispara o download com o cookie de sessao.
export function titularesExportUrl(
  query: Omit<TitularesListQuery, 'page' | 'limit'>,
): string {
  return titularesRoute.export
    .$url({
      query: {
        ...(query.search ? { search: query.search } : {}),
        ...(query.uf?.length ? { uf: query.uf } : {}),
        ...(query.municipio ? { municipio: query.municipio } : {}),
        ...(query.modalidade?.length ? { modalidade: query.modalidade } : {}),
        ...(query.empreendimento?.length
          ? { empreendimento: query.empreendimento }
          : {}),
        ...(query.conjuntoIds?.length
          ? { conjuntoIds: query.conjuntoIds }
          : {}),
        ...(query.logradouros?.length
          ? { logradouros: query.logradouros }
          : {}),
        ...(query.quitacaoStatuses?.length
          ? { quitacaoStatuses: query.quitacaoStatuses }
          : {}),
        ...(query.averbacoes?.length ? { averbacoes: query.averbacoes } : {}),
        ...(query.assinaturaFrom
          ? { assinaturaFrom: query.assinaturaFrom }
          : {}),
        ...(query.assinaturaTo ? { assinaturaTo: query.assinaturaTo } : {}),
      },
    })
    .toString()
}

export async function reconsultarTitularesRequest(
  ids: string[],
): Promise<{ enqueued: number }> {
  const response = await titularesRoute.reconsultar.$post({ json: { ids } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel reconsultar a quitacao.',
      ),
    )
  }

  return (await response.json()) as { enqueued: number }
}

// Filtro do vinculo em massa: mesmos campos da listagem, sem page/limit.
export type TitularesFilter = Omit<TitularesListQuery, 'page' | 'limit'>

// Vincula/desvincula titulares a um conjunto em massa. Alvo = `ids` (selecao) OU
// `filter` (todos os que casam o filtro atual). housingComplexId=null desvincula.
export async function bulkLinkConjuntoRequest(input: {
  housingComplexId: string | null
  ids?: string[]
  filter?: TitularesFilter
}): Promise<{ linked: number; conjuntoNome: string | null }> {
  const response = await titularesRoute['vincular-conjunto'].$post({
    json: {
      housingComplexId: input.housingComplexId,
      ...(input.ids ? { ids: input.ids } : {}),
      ...(input.filter ? { filter: input.filter } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel vincular o conjunto.'),
    )
  }

  return (await response.json()) as {
    linked: number
    conjuntoNome: string | null
  }
}

// Upsert do terceiro vinculado ao titular (exatamente um por titular — salvar de
// novo edita em vez de duplicar).
export async function upsertTerceiroRequest(input: {
  titularId: string
  nome: string
  telefones: string[]
}) {
  const response = await titularesRoute[':id'].terceiro.$put({
    param: { id: input.titularId },
    json: { nome: input.nome, telefones: input.telefones },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel salvar o terceiro.'),
    )
  }

  return await response.json()
}

// URL do endpoint de download (redireciona para a URL pre-assinada). Usada como
// href de ancora — a navegacao inclui o cookie de sessao (admin).
export function titularDocumentDownloadUrl(
  titularId: string,
  docId: string,
): string {
  return titularDocumentoRoute
    .$url({ param: { id: titularId, docId } })
    .toString()
}

// URL pre-assinada INLINE do documento — o viewer de PDF busca os bytes direto
// do S3/MinIO (servir bytes pela API estoura o teto de 10MB do gateway em prod).
export async function fetchTitularDocumentPreviewUrl(
  titularId: string,
  docId: string,
): Promise<string> {
  const response = await titularDocumentoRoute['preview-url'].$get({
    param: { id: titularId, docId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar o documento.',
      ),
    )
  }

  const body = (await response.json()) as { url: string }
  return body.url
}
