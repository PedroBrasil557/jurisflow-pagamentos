import { and, asc, eq, lt, ne, or } from 'drizzle-orm'
import { ServiceError } from '../../shared/errors/service-error'
import { db } from '../../shared/db'
import {
  buildProcessBatchObjectKey,
  createStorageObjectDownloadUrl,
  deleteStorageObject,
  getStorageObjectBytes,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import type { AppBindings } from '../../shared/types/app'
import { buildBatchDownloadFileName } from '../../shared/utils/file-name'
import { user } from '../auth/auth.schema'
import {
  assertCanAccessBatch,
  assertCanAccessDocumentation,
  assertProcessAction,
} from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import {
  getProcessContextOrThrow,
  getProcessRecordOrThrow,
} from './processes.access'
import { assertChecklistUploadAllowed } from './processes.checklist.service'
import { ProcessServiceError } from './processes.errors'
import { extractDocumentsFromFiles } from './processes.extraction.service'
import { createProcessHistoryEntry } from './processes.history.service'
import { importDocumentBundle } from './processes.import.service'
import { processBatchFile } from './processes.schema'
import type { ProcessStatus } from './processes.status'

type ProcessActor = NonNullable<AppBindings['Variables']['user']>

const maxBatchFileSizeInBytes = 25 * 1024 * 1024

function assertBatchFile(file: File) {
  if (file.size <= 0) {
    throw new ProcessServiceError(400, 'Selecione um arquivo valido.')
  }

  if (file.size > maxBatchFileSizeInBytes) {
    throw new ProcessServiceError(413, 'O arquivo excede o limite de 25 MB.')
  }
}

const batchUploadAllowedStatuses = [
  'RASCUNHO',
  'CADASTRADO',
  'EM_LOTE',
  'EM_DOCUMENTACAO',
  'DOCUMENTACAO_PRONTA',
] as const satisfies readonly ProcessStatus[]

function assertBatchUploadAllowed(currentStatus: ProcessStatus) {
  if (
    batchUploadAllowedStatuses.includes(
      currentStatus as (typeof batchUploadAllowedStatuses)[number],
    )
  ) {
    return
  }

  throw new ProcessServiceError(
    409,
    'Nao e possivel enviar arquivos em lote para um processo nesta etapa.',
  )
}

// O status EM_LOTE foi aposentado: enviar/remover arquivos do lote NAO altera
// mais o status do processo. O avanco ocorre apenas por completude do checklist
// (ver syncProcessStatusAfterChecklistChange). Mantido como no-op para preservar
// o contrato de retorno dos call sites (upload/delete de lote).
export async function syncProcessStatusAfterBatchChange(input: {
  processId: string
  actor: ProcessActor
}) {
  return getProcessRecordOrThrow(input.processId)
}

export async function uploadBatchFiles(input: {
  processId: string
  files: File[]
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  assertCanAccessBatch(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'uploadBatch')
  assertBatchUploadAllowed(currentProcess.status)

  if (input.files.length === 0) {
    throw new ProcessServiceError(400, 'Selecione ao menos um arquivo.')
  }

  for (const file of input.files) {
    assertBatchFile(file)
  }

  const uploadedFiles: Array<typeof processBatchFile.$inferSelect> = []

  for (const file of input.files) {
    const fileId = crypto.randomUUID()
    const bucketName = storageBuckets.processDocuments
    const objectKey = buildProcessBatchObjectKey({
      processId: input.processId,
      fileId,
      fileName: file.name,
    })
    const fileBytes = new Uint8Array(await file.arrayBuffer())

    try {
      await uploadStorageObject({
        bucketName,
        objectKey,
        contentType: file.type || 'application/octet-stream',
        body: fileBytes,
      })
    } catch {
      throw new ProcessServiceError(
        503,
        `Nao foi possivel enviar o arquivo "${file.name}" para o storage. Tente novamente.`,
      )
    }

    try {
      const [inserted] = await db
        .insert(processBatchFile)
        .values({
          id: fileId,
          processId: input.processId,
          bucketName,
          objectKey,
          originalFileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeInBytes: file.size,
          uploadedByUserId: input.actor.id,
        })
        .returning()

      uploadedFiles.push(inserted)
    } catch {
      try {
        await deleteStorageObject({ bucketName, objectKey })
      } catch {
        // storage cleanup failed, but DB insert also failed
      }

      throw new ProcessServiceError(
        500,
        `Nao foi possivel salvar o registro do arquivo "${file.name}". Tente novamente.`,
      )
    }
  }

  await createProcessHistoryEntry({
    processId: input.processId,
    actorUserId: input.actor.id,
    eventType: 'BATCH_UPLOADED',
    notes: `${input.files.length} arquivo(s) enviado(s) em lote.`,
  })

  const updatedProcess = await syncProcessStatusAfterBatchChange({
    processId: input.processId,
    actor: input.actor,
  })

  return {
    files: uploadedFiles,
    process: updatedProcess,
    message:
      input.files.length === 1
        ? 'Arquivo enviado em lote com sucesso.'
        : `${input.files.length} arquivos enviados em lote com sucesso.`,
  }
}

export async function listBatchFiles(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
) {
  const { relationship } = await getProcessContextOrThrow({
    processId,
    userId,
    perms,
  })
  assertCanAccessBatch(perms, relationship)

  return db
    .select({
      id: processBatchFile.id,
      originalFileName: processBatchFile.originalFileName,
      mimeType: processBatchFile.mimeType,
      sizeInBytes: processBatchFile.sizeInBytes,
      uploadedAt: processBatchFile.uploadedAt,
      splitStatus: processBatchFile.splitStatus,
      splitMessage: processBatchFile.splitMessage,
      uploadedBy: {
        id: user.id,
        name: user.name,
      },
    })
    .from(processBatchFile)
    .innerJoin(user, eq(processBatchFile.uploadedByUserId, user.id))
    .where(eq(processBatchFile.processId, processId))
    .orderBy(asc(processBatchFile.uploadedAt))
}

export async function deleteBatchFile(input: {
  processId: string
  fileId: string
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  assertCanAccessBatch(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'deleteBatch')
  assertBatchUploadAllowed(currentProcess.status)

  const [fileRecord] = await db
    .select()
    .from(processBatchFile)
    .where(
      and(
        eq(processBatchFile.processId, input.processId),
        eq(processBatchFile.id, input.fileId),
      ),
    )
    .limit(1)

  if (!fileRecord) {
    throw new ProcessServiceError(404, 'Arquivo em lote nao encontrado.')
  }

  try {
    await deleteStorageObject({
      bucketName: fileRecord.bucketName,
      objectKey: fileRecord.objectKey,
    })
  } catch {
    throw new ProcessServiceError(
      503,
      'Nao foi possivel remover o arquivo do storage. Tente novamente.',
    )
  }

  await db.delete(processBatchFile).where(eq(processBatchFile.id, input.fileId))

  await createProcessHistoryEntry({
    processId: input.processId,
    actorUserId: input.actor.id,
    eventType: 'BATCH_DELETED',
    notes: `Arquivo em lote removido: ${fileRecord.originalFileName}.`,
  })

  const updatedProcess = await syncProcessStatusAfterBatchChange({
    processId: input.processId,
    actor: input.actor,
  })

  return {
    process: updatedProcess,
    message: 'Arquivo em lote removido com sucesso.',
  }
}

// Tempo apos o qual um 'processing' e considerado orfao (ex.: processo caiu no
// meio do desmembramento) e pode ser reivindicado por uma nova tentativa.
const SPLIT_STALE_MS = 10 * 60 * 1000

// Nunca lanca: o resultado do desmembramento nao pode depender de uma falha ao
// gravar o status (evita unhandled rejection no job detached).
async function setSplitStatus(
  fileId: string,
  status: 'idle' | 'processing' | 'done' | 'error',
  message: string | null,
) {
  try {
    await db
      .update(processBatchFile)
      .set({
        splitStatus: status,
        splitMessage: message,
        splitUpdatedAt: new Date(),
      })
      .where(eq(processBatchFile.id, fileId))
  } catch (error) {
    console.error('Falha ao gravar status do desmembramento', {
      fileId,
      status,
      error: String(error),
    })
  }
}

// Marca 'processing' de forma ATOMICA (UPDATE condicional): so reivindica se o
// arquivo nao estiver em andamento OU se o 'processing' atual estiver orfao
// (mais antigo que SPLIT_STALE_MS). Retorna true se este chamador reivindicou o
// job — evita que POSTs concorrentes disparem dois desmembramentos do mesmo PDF.
async function claimSplitProcessing(fileId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - SPLIT_STALE_MS)

  const claimed = await db
    .update(processBatchFile)
    .set({ splitStatus: 'processing', splitMessage: null, splitUpdatedAt: new Date() })
    .where(
      and(
        eq(processBatchFile.id, fileId),
        or(
          ne(processBatchFile.splitStatus, 'processing'),
          lt(processBatchFile.splitUpdatedAt, staleBefore),
        ),
      ),
    )
    .returning({ id: processBatchFile.id })

  return claimed.length > 0
}

// Trabalho pesado do desmembramento (IA + split + anexo), executado em segundo
// plano. NUNCA lanca para fora: grava o resultado em splitStatus/splitMessage.
// Depende de um servidor de processo longo (Bun/Hono) — a promise detached
// conclui apos a resposta HTTP. Em serverless precisaria de waitUntil.
async function runBatchFileSplit(input: {
  processId: string
  fileRecord: typeof processBatchFile.$inferSelect
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  const { fileRecord } = input

  try {
    const bytes = await getStorageObjectBytes({
      bucketName: fileRecord.bucketName,
      objectKey: fileRecord.objectKey,
    }).catch(() => {
      throw new ProcessServiceError(
        503,
        'Nao foi possivel ler o arquivo do storage. Tente novamente.',
      )
    })

    const file = new File([new Uint8Array(bytes)], fileRecord.originalFileName, {
      type: 'application/pdf',
    })

    // 1 chamada de IA: classifica as paginas (os campos titular/endereco sao ignorados aqui).
    const { documents } = await extractDocumentsFromFiles([file])

    const result = await importDocumentBundle({
      processId: input.processId,
      file,
      documents,
      actor: input.actor,
      perms: input.perms,
    })

    await setSplitStatus(fileRecord.id, 'done', result.message)
  } catch (error) {
    const message =
      error instanceof ServiceError
        ? error.message
        : 'Nao foi possivel desmembrar o arquivo.'
    console.error('Falha no desmembramento em lote', {
      fileId: fileRecord.id,
      error: String(error),
    })
    await setSplitStatus(fileRecord.id, 'error', message)
  }
}

// Inicia o desmembramento de forma assincrona: valida, marca 'processing' e
// dispara o trabalho pesado sem await. Responde imediatamente para nao depender
// de timeout de proxy numa requisicao longa. O front consulta o status via lote.
export async function startBatchFileSplit(input: {
  processId: string
  fileId: string
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  // Lê do lote e escreve no checklist: exige ambas as permissoes + status valido
  // ANTES de chamar a IA (que tem custo), em vez de falhar so no anexo.
  assertCanAccessBatch(input.perms, relationship)
  assertCanAccessDocumentation(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'uploadChecklist')
  assertChecklistUploadAllowed(currentProcess.status)

  const [fileRecord] = await db
    .select()
    .from(processBatchFile)
    .where(
      and(
        eq(processBatchFile.processId, input.processId),
        eq(processBatchFile.id, input.fileId),
      ),
    )
    .limit(1)

  if (!fileRecord) {
    throw new ProcessServiceError(404, 'Arquivo em lote nao encontrado.')
  }

  if (fileRecord.mimeType.toLowerCase() !== 'application/pdf') {
    throw new ProcessServiceError(
      415,
      'Apenas arquivos PDF podem ser desmembrados.',
    )
  }

  // Idempotencia atomica: se outro POST ja reivindicou o job (e nao esta orfao),
  // nao reprocessa (evita duplo-submit/reentrancia e jobs duplicados).
  const claimed = await claimSplitProcessing(fileRecord.id)
  if (!claimed) {
    return { status: 'processing' as const }
  }

  // Dispara sem await: o trabalho continua apos a resposta HTTP.
  void runBatchFileSplit({
    processId: input.processId,
    fileRecord,
    actor: input.actor,
    perms: input.perms,
  })

  return { status: 'processing' as const }
}

export async function getBatchFileDownload(input: {
  processId: string
  fileId: string
  userId: string
  perms: ResolvedPermissions
}) {
  const { relationship } = await getProcessContextOrThrow({
    processId: input.processId,
    userId: input.userId,
    perms: input.perms,
  })
  assertCanAccessBatch(input.perms, relationship)

  const currentProcess = await getProcessRecordOrThrow(input.processId)

  const [fileRecord] = await db
    .select({
      id: processBatchFile.id,
      bucketName: processBatchFile.bucketName,
      objectKey: processBatchFile.objectKey,
      originalFileName: processBatchFile.originalFileName,
      mimeType: processBatchFile.mimeType,
      sizeInBytes: processBatchFile.sizeInBytes,
      uploadedAt: processBatchFile.uploadedAt,
      uploadedBy: {
        id: user.id,
        name: user.name,
      },
    })
    .from(processBatchFile)
    .innerJoin(user, eq(processBatchFile.uploadedByUserId, user.id))
    .where(
      and(
        eq(processBatchFile.processId, input.processId),
        eq(processBatchFile.id, input.fileId),
      ),
    )
    .limit(1)

  if (!fileRecord) {
    throw new ProcessServiceError(404, 'Arquivo em lote nao encontrado.')
  }

  const expiresInSeconds = 60 * 10

  let downloadUrl: string

  try {
    downloadUrl = await createStorageObjectDownloadUrl({
      bucketName: fileRecord.bucketName,
      objectKey: fileRecord.objectKey,
      expiresInSeconds,
    })
  } catch {
    throw new ProcessServiceError(
      503,
      'Nao foi possivel preparar o download do arquivo. Tente novamente.',
    )
  }

  const downloadFileName = buildBatchDownloadFileName({
    processCode: currentProcess.code,
    processFullName: currentProcess.fullName,
    originalFileName: fileRecord.originalFileName,
  })

  return {
    file: {
      id: fileRecord.id,
      originalFileName: fileRecord.originalFileName,
      downloadFileName,
      mimeType: fileRecord.mimeType,
      sizeInBytes: fileRecord.sizeInBytes,
      uploadedAt: fileRecord.uploadedAt,
      uploadedBy: fileRecord.uploadedBy,
    },
    downloadUrl,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  }
}

export async function downloadAllBatchFiles(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
) {
  const { relationship } = await getProcessContextOrThrow({
    processId,
    userId,
    perms,
  })
  assertCanAccessBatch(perms, relationship)

  const currentProcess = await getProcessRecordOrThrow(processId)

  const files = await db
    .select({
      id: processBatchFile.id,
      bucketName: processBatchFile.bucketName,
      objectKey: processBatchFile.objectKey,
      originalFileName: processBatchFile.originalFileName,
    })
    .from(processBatchFile)
    .where(eq(processBatchFile.processId, processId))
    .orderBy(asc(processBatchFile.uploadedAt))

  if (files.length === 0) {
    return { files: [] }
  }

  const expiresInSeconds = 60 * 10
  const result = await Promise.all(
    files.map(async (file) => {
      const downloadUrl = await createStorageObjectDownloadUrl({
        bucketName: file.bucketName,
        objectKey: file.objectKey,
        expiresInSeconds,
      })

      const downloadFileName = buildBatchDownloadFileName({
        processCode: currentProcess.code,
        processFullName: currentProcess.fullName,
        originalFileName: file.originalFileName,
      })

      return {
        id: file.id,
        originalFileName: downloadFileName,
        downloadUrl,
      }
    }),
  )

  return { files: result }
}
