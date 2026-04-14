import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildProcessBatchObjectKey,
  createStorageObjectDownloadUrl,
  deleteStorageObject,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import type { AppBindings } from '../../shared/types/app'
import { buildBatchDownloadFileName } from '../../shared/utils/file-name'
import { user } from '../auth/auth.schema'
import {
  assertCanAccessBatch,
  assertProcessAction,
} from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import {
  getProcessContextOrThrow,
  getProcessRecordOrThrow,
} from './processes.access'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import { process, processBatchFile } from './processes.schema'
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

async function getBatchFileCount(processId: string) {
  const [result] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(processBatchFile)
    .where(eq(processBatchFile.processId, processId))

  return result?.total ?? 0
}

export async function syncProcessStatusAfterBatchChange(input: {
  processId: string
  actor: ProcessActor
}) {
  const currentProcess = await getProcessRecordOrThrow(input.processId)

  if (
    currentProcess.status !== 'CADASTRADO' &&
    currentProcess.status !== 'EM_LOTE'
  ) {
    return currentProcess
  }

  const batchCount = await getBatchFileCount(input.processId)

  if (currentProcess.status === 'CADASTRADO' && batchCount > 0) {
    const [updated] = await db
      .update(process)
      .set({ status: 'EM_LOTE' })
      .where(eq(process.id, input.processId))
      .returning()

    await createProcessHistoryEntry({
      processId: input.processId,
      actorUserId: input.actor.id,
      eventType: 'STATUS_CHANGED',
      fromStatus: 'CADASTRADO',
      toStatus: 'EM_LOTE',
      notes: 'Arquivos enviados em lote.',
    })

    return updated
  }

  if (currentProcess.status === 'EM_LOTE' && batchCount === 0) {
    const [updated] = await db
      .update(process)
      .set({ status: 'CADASTRADO' })
      .where(eq(process.id, input.processId))
      .returning()

    await createProcessHistoryEntry({
      processId: input.processId,
      actorUserId: input.actor.id,
      eventType: 'STATUS_CHANGED',
      fromStatus: 'EM_LOTE',
      toStatus: 'CADASTRADO',
      notes: 'Todos os arquivos em lote foram removidos.',
    })

    return updated
  }

  return currentProcess
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
