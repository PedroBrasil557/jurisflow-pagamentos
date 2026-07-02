import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'
import { reportClientError } from '@/shared/services/telemetry'

const presignScanRoute = apiClient.api.processes.scan.presign
const completeScanRoute = apiClient.api.processes.scan.complete
const presignImportRoute = apiClient.api.processes.import.presign
const completeImportRoute = apiClient.api.processes.import.complete
const reprocessImportClientRoute =
  apiClient.api.processes[':processId']['reprocess-import']

type PresignScanResponse = InferResponseType<typeof presignScanRoute.$post, 200>
export type CreateProcessViaScanResponse = InferResponseType<
  typeof completeScanRoute.$post,
  202
>

// PUT direto no S3 com progresso de upload (XHR expoe o evento `progress`, que o
// fetch nao da). Necessario porque um PDF de 8-16MB em 3G/4G fraco demora e sem
// barra o usuario acha que travou.
function putToS3WithProgress(
  url: string,
  body: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', 'application/pdf')
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total)
        }
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Falha ao enviar a digitalizacao (${xhr.status}).`))
      }
    }
    xhr.onerror = () => reject(new Error('Falha de rede ao enviar a digitalizacao.'))
    xhr.onabort = () => reject(new Error('Envio da digitalizacao cancelado.'))
    xhr.send(body)
  })
}

// Cria um processo RASCUNHO a partir do scan via upload PRE-ASSINADO S3 (o PDF vai
// DIRETO ao S3, sem passar pela API — sem o teto de 10MB do API Gateway). Fluxo:
// 1) presign (uploadId opaco, sem processo) -> 2) PUT no S3 -> 3) complete (cria
// o rascunho + dispara a ingestao). Retorna { processId, batchFileId }; o
// andamento e acompanhado pelo splitStatus do lote (polling). Idempotente: um
// retry do complete devolve o mesmo processo.
export async function createProcessViaScanRequest(
  pdf: Blob,
  onProgress?: (fraction: number) => void,
): Promise<CreateProcessViaScanResponse> {
  // 1) presign
  const presignRes = await presignScanRoute.$post({
    json: { contentType: 'application/pdf', size: pdf.size },
  })
  if (!presignRes.ok) {
    throw new Error(
      await getErrorMessage(
        presignRes,
        'Nao foi possivel iniciar a digitalizacao.',
      ),
    )
  }
  const { uploadId, objectKey, uploadUrl } =
    (await presignRes.json()) as PresignScanResponse

  // 2) PUT direto no S3.
  try {
    await putToS3WithProgress(uploadUrl, pdf, onProgress)
  } catch (error) {
    reportClientError('scan_s3_put_error', {
      uploadId,
      sizeBytes: pdf.size,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      'Falha de rede ao enviar a digitalizacao (a conexao caiu ou foi bloqueada). Tente novamente.',
    )
  }

  // 3) complete -> cria o rascunho, registra no lote e dispara a ingestao.
  const completeRes = await completeScanRoute.$post({
    json: { uploadId, objectKey },
  })
  if (!completeRes.ok) {
    throw new Error(
      await getErrorMessage(
        completeRes,
        'Nao foi possivel concluir a digitalizacao.',
      ),
    )
  }

  return (await completeRes.json()) as CreateProcessViaScanResponse
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
