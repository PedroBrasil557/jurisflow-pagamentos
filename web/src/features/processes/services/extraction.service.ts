import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'
import { reportClientError } from '@/shared/services/telemetry'

const scanClientRoute = apiClient.api.processes.scan
const importClientRoute = apiClient.api.processes.import
const reprocessImportClientRoute =
  apiClient.api.processes[':processId']['reprocess-import']

export type CreateProcessViaScanResponse = InferResponseType<
  typeof scanClientRoute.$post,
  202
>

// Cria um processo RASCUNHO a partir do scan e dispara a ingestao em background.
// Retorna na hora { processId, batchFileId }; o andamento e acompanhado pelo
// splitStatus do lote (polling).
export async function createProcessViaScanRequest(
  file: File,
): Promise<CreateProcessViaScanResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(scanClientRoute.$url(), {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel iniciar a digitalizacao.',
      ),
    )
  }

  return (await response.json()) as CreateProcessViaScanResponse
}

export type ImportDocumentResponse = InferResponseType<
  typeof importClientRoute.$post,
  202
>

// Importar documentos: envia 1+ PDFs, cria o rascunho e dispara a ingestao
// durável/assincrona SEQUENCIAL (mesma do scan). Retorna na hora { processId,
// batchFileIds }; o front navega para o editor e acompanha via splitStatus.
export async function importDocumentRequest(
  files: File[],
): Promise<ImportDocumentResponse> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('file', file)
  }

  let response: Response
  try {
    response = await fetch(importClientRoute.$url(), {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
  } catch (error) {
    // Falha de REDE no upload (ex.: "Failed to fetch"/ERR_FAILED — conexao caiu,
    // antivirus/proxy/extensao bloqueou). Reporta via telemetria (P1) com
    // contexto, pois nao chega ao endpoint.
    reportClientError('import_network_error', {
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      'Falha de rede ao enviar os documentos (a conexao caiu ou foi bloqueada por antivirus/proxy/extensao). Verifique a rede e tente novamente.',
    )
  }

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') ?? undefined
    reportClientError('import_http_error', {
      status: response.status,
      requestId,
    })
    const base = await getErrorMessage(
      response,
      'Nao foi possivel importar os documentos.',
    )
    throw new Error(requestId ? `${base} (cod: ${requestId})` : base)
  }

  return (await response.json()) as ImportDocumentResponse
}

// Reprocessa a ingestao dos documentos que falharam (continuidade): re-roda a
// extracao/anexo do PDF que ja esta no lote. Retorna 202; o front acompanha via
// splitStatus (polling).
export async function reprocessImportRequest(processId: string) {
  const response = await reprocessImportClientRoute.$post({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel reprocessar os documentos.',
      ),
    )
  }

  return response.json()
}
