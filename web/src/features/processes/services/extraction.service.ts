import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'
import { reportClientError } from '@/shared/services/telemetry'

const scanClientRoute = apiClient.api.processes.scan
const presignImportRoute = apiClient.api.processes.import.presign
const completeImportRoute = apiClient.api.processes.import.complete
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

type PresignImportResponse = InferResponseType<
  typeof presignImportRoute.$post,
  200
>

// Importar documentos via upload PRE-ASSINADO S3: o browser sobe os PDFs DIRETO
// no S3 (sem o teto de 10MB do API Gateway). Fluxo: 1) presign (cria o rascunho
// + URLs assinadas) -> 2) PUT cada arquivo no S3 -> 3) complete (registra +
// dispara a ingestao). Retorna { processId }; o front navega para o editor.
export async function importDocumentRequest(
  files: File[],
): Promise<{ processId: string }> {
  // 1) presign
  const presignRes = await presignImportRoute.$post({
    json: {
      files: files.map((file) => ({
        fileName: file.name,
        contentType: 'application/pdf',
        size: file.size,
      })),
    },
  })
  if (!presignRes.ok) {
    throw new Error(
      await getErrorMessage(presignRes, 'Nao foi possivel iniciar o import.'),
    )
  }
  const { processId, uploads } =
    (await presignRes.json()) as PresignImportResponse

  // 2) PUT cada arquivo DIRETO no S3 (browser -> S3), em paralelo.
  try {
    await Promise.all(
      uploads.map(async (upload, index) => {
        const putRes = await fetch(upload.uploadUrl, {
          method: 'PUT',
          body: files[index],
          headers: { 'Content-Type': 'application/pdf' },
        })
        if (!putRes.ok) {
          throw new Error(
            `Falha ao enviar "${files[index].name}" (${putRes.status}).`,
          )
        }
      }),
    )
  } catch (error) {
    reportClientError('import_s3_put_error', {
      processId,
      fileCount: files.length,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      'Falha de rede ao enviar os documentos (a conexao caiu ou foi bloqueada). Tente novamente.',
    )
  }

  // 3) complete -> registra os arquivos no lote e dispara a ingestao.
  const completeRes = await completeImportRoute.$post({
    json: {
      processId,
      files: uploads.map((upload, index) => ({
        fileId: upload.fileId,
        objectKey: upload.objectKey,
        fileName: files[index].name,
      })),
    },
  })
  if (!completeRes.ok) {
    throw new Error(
      await getErrorMessage(completeRes, 'Nao foi possivel concluir o import.'),
    )
  }

  return { processId }
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
