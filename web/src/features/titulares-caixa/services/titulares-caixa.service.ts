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

export const titularQuitacaoStatusLabels: Record<TitularQuitacaoStatus, string> =
  {
    idle: 'Sem consulta',
    pending: 'Pendente',
    quitado: 'Quitado',
    nao_encontrado: 'Nao encontrado',
    erro: 'Erro',
  }

export type TitularesListQuery = {
  page?: number
  limit?: number
  search?: string
  uf?: string[]
  municipio?: string
  modalidade?: string[]
  empreendimento?: string[]
  quitacaoStatuses?: TitularQuitacaoStatus[]
  assinaturaFrom?: string
  assinaturaTo?: string
}

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
      ...(query.quitacaoStatuses?.length
        ? { quitacaoStatuses: query.quitacaoStatuses }
        : {}),
      ...(query.assinaturaFrom ? { assinaturaFrom: query.assinaturaFrom } : {}),
      ...(query.assinaturaTo ? { assinaturaTo: query.assinaturaTo } : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel carregar os titulares.'),
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
      await getErrorMessage(response, 'Nao foi possivel carregar os empreendimentos.'),
    )
  }

  const body = (await response.json()) as { options: string[] }
  return body.options
}

export async function reconsultarTitularesRequest(
  ids: string[],
): Promise<{ enqueued: number }> {
  const response = await titularesRoute.reconsultar.$post({ json: { ids } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel reconsultar a quitacao.'),
    )
  }

  return (await response.json()) as { enqueued: number }
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

// URL do endpoint de PREVIEW inline (redireciona para a URL pre-assinada inline).
// Usada como src de iframe — renderiza o PDF no navegador sem baixar.
export function titularDocumentPreviewUrl(
  titularId: string,
  docId: string,
): string {
  return titularDocumentoRoute.preview
    .$url({ param: { id: titularId, docId } })
    .toString()
}
