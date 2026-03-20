import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildProcessDocumentObjectKey,
  createStorageObjectDownloadUrl,
  deleteStorageObject,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import type { AppBindings } from '../../shared/types/app'
import { user } from '../auth/auth.schema'
import { defaultProcessDocumentTypes } from './processes.documents'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  process,
  processDocument,
  processDocumentFile,
  processDocumentType,
} from './processes.schema'
import type { ProcessStatus } from './processes.status'

type ProcessActor = NonNullable<AppBindings['Variables']['user']>
type ProcessRecord = typeof process.$inferSelect
type ChecklistFileRecord = Awaited<ReturnType<typeof listCurrentChecklistFiles>>
type ProcessChecklistItemRecord = Awaited<
  ReturnType<typeof getChecklistItemOrThrow>
>
type ChecklistSubmitResult = Awaited<ReturnType<typeof getProcessChecklist>> & {
  message: string
  process: ProcessRecord
}

const maxProcessDocumentFileSizeInBytes = 25 * 1024 * 1024
const maxChecklistObservationLength = 300
const checklistUploadAllowedStatuses = [
  'EM_DOCUMENTACAO',
  'DOCUMENTACAO_PRONTA',
] as const satisfies readonly ProcessStatus[]

async function ensureProcessExists(processId: string) {
  const [currentProcess] = await db
    .select({
      id: process.id,
    })
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)

  if (!currentProcess) {
    throw new ProcessServiceError(404, 'Processo nao encontrado.')
  }
}

async function getProcessRecordOrThrow(processId: string) {
  const [currentProcess] = await db
    .select()
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)

  if (!currentProcess) {
    throw new ProcessServiceError(404, 'Processo nao encontrado.')
  }

  return currentProcess
}

function assertChecklistUploadAllowed(currentStatus: ProcessStatus) {
  if (
    checklistUploadAllowedStatuses.includes(
      currentStatus as (typeof checklistUploadAllowedStatuses)[number],
    )
  ) {
    return
  }

  throw new ProcessServiceError(
    409,
    'Nao e possivel anexar documentos para um processo nesta etapa.',
  )
}

function assertChecklistFile(file: File) {
  if (file.size <= 0) {
    throw new ProcessServiceError(400, 'Selecione um arquivo valido.')
  }

  if (file.size > maxProcessDocumentFileSizeInBytes) {
    throw new ProcessServiceError(413, 'O arquivo excede o limite de 25 MB.')
  }
}

function normalizeChecklistObservation(value?: string | null) {
  return (value ?? '')
    .trim()
    .slice(0, maxChecklistObservationLength)
    .toUpperCase()
}

function getChecklistPresenceStatus(input: {
  currentFileCount: number
  status: string
}) {
  return input.currentFileCount > 0 || input.status === 'OK_SEM_ARQUIVO'
}

async function listActiveDocumentTypes() {
  await ensureDefaultProcessDocumentTypes()

  return db
    .select({
      id: processDocumentType.id,
      key: processDocumentType.key,
      label: processDocumentType.label,
      description: processDocumentType.description,
      sortOrder: processDocumentType.sortOrder,
      isRequired: processDocumentType.isRequired,
      allowsMultipleFiles: processDocumentType.allowsMultipleFiles,
    })
    .from(processDocumentType)
    .where(eq(processDocumentType.isActive, true))
    .orderBy(asc(processDocumentType.sortOrder))
}

async function ensureDefaultProcessDocumentTypes() {
  const existingTypes = await db
    .select({
      key: processDocumentType.key,
    })
    .from(processDocumentType)

  const existingKeys = new Set(existingTypes.map((item) => item.key))
  const missingTypes = defaultProcessDocumentTypes.filter(
    (documentType) => !existingKeys.has(documentType.key),
  )

  if (missingTypes.length === 0) {
    return
  }

  await db
    .insert(processDocumentType)
    .values(
      missingTypes.map((documentType) => ({
        id: crypto.randomUUID(),
        key: documentType.key,
        label: documentType.label,
        sortOrder: documentType.sortOrder,
        isRequired: documentType.isRequired,
        allowsMultipleFiles: documentType.allowsMultipleFiles,
        isActive: true,
      })),
    )
    .onConflictDoNothing({
      target: processDocumentType.key,
    })
}

export async function ensureProcessChecklistItems(processId: string) {
  await ensureProcessExists(processId)

  const [activeDocumentTypes, existingItems] = await Promise.all([
    listActiveDocumentTypes(),
    db
      .select({
        documentTypeId: processDocument.documentTypeId,
      })
      .from(processDocument)
      .where(eq(processDocument.processId, processId)),
  ])

  const existingTypeIds = new Set(
    existingItems.map((item) => item.documentTypeId),
  )
  const missingItems = activeDocumentTypes.filter(
    (documentType) => !existingTypeIds.has(documentType.id),
  )

  if (missingItems.length === 0) {
    return
  }

  await db.insert(processDocument).values(
    missingItems.map((documentType) => ({
      id: crypto.randomUUID(),
      processId,
      documentTypeId: documentType.id,
      status: 'PENDENTE' as const,
      observation: '',
    })),
  )
}

async function getChecklistItemOrThrow(
  processId: string,
  processDocumentId: string,
) {
  const [checklistItem] = await db
    .select({
      id: processDocument.id,
      processId: processDocument.processId,
      status: processDocument.status,
      observation: processDocument.observation,
      processStatus: process.status,
      documentType: {
        id: processDocumentType.id,
        key: processDocumentType.key,
        label: processDocumentType.label,
        description: processDocumentType.description,
        sortOrder: processDocumentType.sortOrder,
        isRequired: processDocumentType.isRequired,
        allowsMultipleFiles: processDocumentType.allowsMultipleFiles,
      },
    })
    .from(processDocument)
    .innerJoin(process, eq(processDocument.processId, process.id))
    .innerJoin(
      processDocumentType,
      eq(processDocument.documentTypeId, processDocumentType.id),
    )
    .where(
      and(
        eq(processDocument.processId, processId),
        eq(processDocument.id, processDocumentId),
      ),
    )
    .limit(1)

  if (!checklistItem) {
    throw new ProcessServiceError(404, 'Item do checklist nao encontrado.')
  }

  return checklistItem
}

async function getChecklistFileOrThrow(input: {
  processId: string
  processDocumentId: string
  fileId: string
}) {
  const [fileRecord] = await db
    .select({
      id: processDocumentFile.id,
      processDocumentId: processDocumentFile.processDocumentId,
      bucketName: processDocumentFile.bucketName,
      objectKey: processDocumentFile.objectKey,
      originalFileName: processDocumentFile.originalFileName,
      mimeType: processDocumentFile.mimeType,
      sizeInBytes: processDocumentFile.sizeInBytes,
      revision: processDocumentFile.revision,
      uploadedAt: processDocumentFile.uploadedAt,
      uploadedBy: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    })
    .from(processDocumentFile)
    .innerJoin(
      processDocument,
      eq(processDocumentFile.processDocumentId, processDocument.id),
    )
    .innerJoin(user, eq(processDocumentFile.uploadedByUserId, user.id))
    .where(
      and(
        eq(processDocument.processId, input.processId),
        eq(processDocument.id, input.processDocumentId),
        eq(processDocumentFile.id, input.fileId),
      ),
    )
    .limit(1)

  if (!fileRecord) {
    throw new ProcessServiceError(404, 'Arquivo do checklist nao encontrado.')
  }

  return fileRecord
}

async function listCurrentChecklistFiles(checklistItemIds: readonly string[]) {
  if (checklistItemIds.length === 0) {
    return []
  }

  return db
    .select({
      id: processDocumentFile.id,
      processDocumentId: processDocumentFile.processDocumentId,
      originalFileName: processDocumentFile.originalFileName,
      mimeType: processDocumentFile.mimeType,
      sizeInBytes: processDocumentFile.sizeInBytes,
      revision: processDocumentFile.revision,
      uploadedAt: processDocumentFile.uploadedAt,
      uploadedBy: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    })
    .from(processDocumentFile)
    .innerJoin(user, eq(processDocumentFile.uploadedByUserId, user.id))
    .where(
      and(
        inArray(processDocumentFile.processDocumentId, checklistItemIds),
        eq(processDocumentFile.isCurrent, true),
      ),
    )
    .orderBy(
      asc(processDocumentFile.processDocumentId),
      desc(processDocumentFile.uploadedAt),
    )
}

function groupCurrentFilesByChecklistItemId(currentFiles: ChecklistFileRecord) {
  const currentFilesByChecklistItemId = new Map<
    string,
    ChecklistFileRecord[number][]
  >()

  for (const currentFile of currentFiles) {
    const existingFiles =
      currentFilesByChecklistItemId.get(currentFile.processDocumentId) ?? []

    existingFiles.push(currentFile)
    currentFilesByChecklistItemId.set(
      currentFile.processDocumentId,
      existingFiles,
    )
  }

  return currentFilesByChecklistItemId
}

function buildHistoryNote(
  checklistItem: ProcessChecklistItemRecord,
  fileName: string,
  action: 'upload' | 'replace',
) {
  const actionLabel =
    action === 'replace' ? 'Arquivo substituido' : 'Arquivo anexado'

  return `${actionLabel}: ${checklistItem.documentType.label} (${fileName}).`
}

function buildObservationHistoryNote(
  checklistItem: ProcessChecklistItemRecord,
) {
  return `Observacao atualizada: ${checklistItem.documentType.label}.`
}

function buildMarkOkWithoutFileHistoryNote(
  checklistItem: ProcessChecklistItemRecord,
) {
  return `Item marcado como OK sem arquivo: ${checklistItem.documentType.label}.`
}

function buildUnmarkOkWithoutFileHistoryNote(
  checklistItem: ProcessChecklistItemRecord,
) {
  return `Marcacao OK sem arquivo removida: ${checklistItem.documentType.label}.`
}

function getChecklistSubmitSuccessMessage(input: {
  hasObservationChange: boolean
  markOkWithoutFile: boolean
  unmarkedOkWithoutFile: boolean
  replacedFile: boolean
  uploadedFile: boolean
}) {
  if (input.uploadedFile) {
    if (input.replacedFile) {
      return input.hasObservationChange
        ? 'Arquivo substituido e observacao salvos com sucesso.'
        : 'Arquivo substituido com sucesso.'
    }

    return input.hasObservationChange
      ? 'Arquivo enviado e observacao salvos com sucesso.'
      : 'Arquivo enviado com sucesso.'
  }

  if (input.markOkWithoutFile) {
    return input.hasObservationChange
      ? 'Item marcado como ok sem arquivo e observacao salvos com sucesso.'
      : 'Item marcado como ok sem arquivo.'
  }

  if (input.unmarkedOkWithoutFile) {
    return input.hasObservationChange
      ? 'Item desmarcado como ok sem arquivo e observacao salvos com sucesso.'
      : 'Item desmarcado como ok sem arquivo.'
  }

  return 'Observacao salva com sucesso.'
}

function buildChecklistResponse(input: {
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>
  currentFiles: ChecklistFileRecord
}) {
  const currentFilesByChecklistItemId = groupCurrentFilesByChecklistItemId(
    input.currentFiles,
  )

  const items = input.checklistItems.map((checklistItem) => {
    const files = currentFilesByChecklistItemId.get(checklistItem.id) ?? []

    return {
      id: checklistItem.id,
      status: checklistItem.status,
      observation: checklistItem.observation,
      documentType: checklistItem.documentType,
      currentFiles: files,
    }
  })

  const requiredItems = items.filter((item) => item.documentType.isRequired)
  const requiredCompleted = requiredItems.filter((item) =>
    getChecklistPresenceStatus({
      currentFileCount: item.currentFiles.length,
      status: item.status,
    }),
  ).length

  return {
    items,
    summary: {
      requiredCompleted,
      requiredPending: requiredItems.length - requiredCompleted,
      requiredTotal: requiredItems.length,
      totalItems: items.length,
    },
  }
}

async function listChecklistItems(processId: string) {
  return db
    .select({
      id: processDocument.id,
      status: processDocument.status,
      observation: processDocument.observation,
      documentType: {
        id: processDocumentType.id,
        key: processDocumentType.key,
        label: processDocumentType.label,
        description: processDocumentType.description,
        sortOrder: processDocumentType.sortOrder,
        isRequired: processDocumentType.isRequired,
        allowsMultipleFiles: processDocumentType.allowsMultipleFiles,
      },
    })
    .from(processDocument)
    .innerJoin(
      processDocumentType,
      eq(processDocument.documentTypeId, processDocumentType.id),
    )
    .where(eq(processDocument.processId, processId))
    .orderBy(asc(processDocumentType.sortOrder))
}

async function updateChecklistItemObservation(input: {
  checklistItem: ProcessChecklistItemRecord
  nextObservation: string
  actor: ProcessActor
  executor?: Pick<typeof db, 'update' | 'insert'>
}) {
  if (input.checklistItem.observation === input.nextObservation) {
    return
  }

  const executor = input.executor ?? db

  await executor
    .update(processDocument)
    .set({
      observation: input.nextObservation,
    })
    .where(eq(processDocument.id, input.checklistItem.id))

  await createProcessHistoryEntry({
    processId: input.checklistItem.processId,
    actorUserId: input.actor.id,
    eventType: 'DOCUMENT_OBSERVATION_UPDATED',
    notes: buildObservationHistoryNote(input.checklistItem),
    executor,
  })
}

async function markChecklistItemOkWithoutFile(input: {
  checklistItem: ProcessChecklistItemRecord
  actor: ProcessActor
  executor?: Pick<typeof db, 'select' | 'update' | 'insert'>
}) {
  const executor = input.executor ?? db

  const [currentFileSummary] = await executor
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(processDocumentFile)
    .where(
      and(
        eq(processDocumentFile.processDocumentId, input.checklistItem.id),
        eq(processDocumentFile.isCurrent, true),
      ),
    )

  if ((currentFileSummary?.total ?? 0) > 0) {
    throw new ProcessServiceError(
      409,
      'Nao e possivel marcar OK sem arquivo quando ja existe um arquivo atual.',
    )
  }

  if (input.checklistItem.status === 'OK_SEM_ARQUIVO') {
    return
  }

  await executor
    .update(processDocument)
    .set({
      status: 'OK_SEM_ARQUIVO',
    })
    .where(eq(processDocument.id, input.checklistItem.id))

  await createProcessHistoryEntry({
    processId: input.checklistItem.processId,
    actorUserId: input.actor.id,
    eventType: 'DOCUMENT_MARKED_OK_WITHOUT_FILE',
    notes: buildMarkOkWithoutFileHistoryNote(input.checklistItem),
    executor,
  })
}

async function unmarkChecklistItemOkWithoutFile(input: {
  checklistItem: ProcessChecklistItemRecord
  actor: ProcessActor
  executor?: Pick<typeof db, 'select' | 'update' | 'insert'>
}) {
  const executor = input.executor ?? db

  if (input.checklistItem.status !== 'OK_SEM_ARQUIVO') {
    return
  }

  const [currentFileSummary] = await executor
    .select({
      total: sql<number>`count(*)::int`,
    })
    .from(processDocumentFile)
    .where(
      and(
        eq(processDocumentFile.processDocumentId, input.checklistItem.id),
        eq(processDocumentFile.isCurrent, true),
      ),
    )

  await executor
    .update(processDocument)
    .set({
      status: (currentFileSummary?.total ?? 0) > 0 ? 'ANEXADO' : 'PENDENTE',
    })
    .where(eq(processDocument.id, input.checklistItem.id))

  await createProcessHistoryEntry({
    processId: input.checklistItem.processId,
    actorUserId: input.actor.id,
    eventType: 'DOCUMENT_UNMARKED_OK_WITHOUT_FILE',
    notes: buildUnmarkOkWithoutFileHistoryNote(input.checklistItem),
    executor,
  })
}

async function attachChecklistFile(input: {
  checklistItem: ProcessChecklistItemRecord
  file: File
  actor: ProcessActor
  executor?: Pick<typeof db, 'select' | 'insert' | 'update'>
}) {
  assertChecklistFile(input.file)

  const executor = input.executor ?? db

  const [[revisionSummary], currentFiles] = await Promise.all([
    executor
      .select({
        maxRevision: sql<number>`coalesce(max(${processDocumentFile.revision}), 0)::int`,
      })
      .from(processDocumentFile)
      .where(eq(processDocumentFile.processDocumentId, input.checklistItem.id)),
    executor
      .select({
        id: processDocumentFile.id,
      })
      .from(processDocumentFile)
      .where(
        and(
          eq(processDocumentFile.processDocumentId, input.checklistItem.id),
          eq(processDocumentFile.isCurrent, true),
        ),
      ),
  ])

  const shouldReplace =
    !input.checklistItem.documentType.allowsMultipleFiles &&
    currentFiles.length > 0
  const fileId = crypto.randomUUID()
  const nextRevision = (revisionSummary?.maxRevision ?? 0) + 1
  const uploadedAt = new Date()
  const bucketName = storageBuckets.processDocuments
  const objectKey = buildProcessDocumentObjectKey({
    processId: input.checklistItem.processId,
    documentTypeKey: input.checklistItem.documentType.key,
    fileId,
    fileName: input.file.name,
  })
  const fileBytes = new Uint8Array(await input.file.arrayBuffer())

  try {
    await uploadStorageObject({
      bucketName,
      objectKey,
      contentType: input.file.type || 'application/octet-stream',
      body: fileBytes,
    })
  } catch {
    throw new ProcessServiceError(
      503,
      'Nao foi possivel enviar o arquivo para o storage. Tente novamente.',
    )
  }

  try {
    if (shouldReplace) {
      await executor
        .update(processDocumentFile)
        .set({
          isCurrent: false,
          replacedAt: uploadedAt,
        })
        .where(
          and(
            eq(processDocumentFile.processDocumentId, input.checklistItem.id),
            eq(processDocumentFile.isCurrent, true),
          ),
        )
    }

    await executor.insert(processDocumentFile).values({
      id: fileId,
      processDocumentId: input.checklistItem.id,
      bucketName,
      objectKey,
      originalFileName: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      sizeInBytes: input.file.size,
      revision: nextRevision,
      isCurrent: true,
      uploadedByUserId: input.actor.id,
      uploadedAt,
      replacedAt: null,
    })

    await executor
      .update(processDocument)
      .set({
        status: 'ANEXADO',
      })
      .where(eq(processDocument.id, input.checklistItem.id))

    await createProcessHistoryEntry({
      processId: input.checklistItem.processId,
      actorUserId: input.actor.id,
      eventType: shouldReplace ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
      notes: buildHistoryNote(
        input.checklistItem,
        input.file.name,
        shouldReplace ? 'replace' : 'upload',
      ),
      executor,
    })
  } catch (error) {
    try {
      await deleteStorageObject({
        bucketName,
        objectKey,
      })
    } catch {
      throw new ProcessServiceError(
        500,
        'Nao foi possivel concluir o envio do arquivo. O registro foi interrompido e o storage precisa ser validado.',
      )
    }

    if (error instanceof ProcessServiceError) {
      throw error
    }

    throw new ProcessServiceError(
      500,
      'Nao foi possivel concluir o envio do arquivo. Tente novamente.',
    )
  }

  return {
    didUploadFile: true,
    didReplaceFile: shouldReplace,
  }
}

async function syncProcessStatusAfterChecklistChange(input: {
  actor: ProcessActor
  checklist: Awaited<ReturnType<typeof getProcessChecklist>>
  processId: string
}) {
  const currentProcess = await getProcessRecordOrThrow(input.processId)

  if (
    currentProcess.status === 'DOCUMENTACAO_PRONTA' &&
    input.checklist.summary.requiredPending > 0
  ) {
    const [updatedProcess] = await db
      .update(process)
      .set({
        status: 'EM_DOCUMENTACAO',
        documentationReadyAt: null,
      })
      .where(eq(process.id, input.processId))
      .returning()

    await createProcessHistoryEntry({
      processId: input.processId,
      actorUserId: input.actor.id,
      eventType: 'STATUS_CHANGED',
      fromStatus: 'DOCUMENTACAO_PRONTA',
      toStatus: 'EM_DOCUMENTACAO',
      notes: 'Documentacao voltou a ficar pendente.',
    })

    return updatedProcess
  }

  return currentProcess
}

export async function getProcessChecklist(processId: string) {
  await ensureProcessExists(processId)
  await ensureProcessChecklistItems(processId)

  const checklistItems = await listChecklistItems(processId)
  const currentFiles = await listCurrentChecklistFiles(
    checklistItems.map((item) => item.id),
  )

  return buildChecklistResponse({
    checklistItems,
    currentFiles,
  })
}

export async function submitProcessChecklistItem(input: {
  processId: string
  processDocumentId: string
  actor: ProcessActor
  file?: File | null
  markOkWithoutFile?: boolean
  observation?: string
}): Promise<ChecklistSubmitResult> {
  const checklistItem = await getChecklistItemOrThrow(
    input.processId,
    input.processDocumentId,
  )

  assertChecklistUploadAllowed(checklistItem.processStatus)

  if (input.file && input.markOkWithoutFile) {
    throw new ProcessServiceError(
      400,
      'Nao e possivel anexar um arquivo e marcar OK sem arquivo ao mesmo tempo.',
    )
  }

  const nextObservation = normalizeChecklistObservation(input.observation)
  const hasObservationChange = checklistItem.observation !== nextObservation
  const shouldMarkOkWithoutFile = input.markOkWithoutFile === true
  const shouldUnmarkOkWithoutFile =
    input.markOkWithoutFile === false &&
    checklistItem.status === 'OK_SEM_ARQUIVO'
  const selectedFile = input.file ?? null

  if (
    !selectedFile &&
    !shouldMarkOkWithoutFile &&
    !shouldUnmarkOkWithoutFile &&
    !hasObservationChange
  ) {
    throw new ProcessServiceError(
      400,
      'Nenhuma alteracao foi informada para este item do checklist.',
    )
  }

  let didUploadFile = false
  let didReplaceFile = false

  if (selectedFile) {
    await db.transaction(async (tx) => {
      if (hasObservationChange) {
        await updateChecklistItemObservation({
          checklistItem,
          nextObservation,
          actor: input.actor,
          executor: tx,
        })
      }

      const uploadResult = await attachChecklistFile({
        checklistItem,
        file: selectedFile,
        actor: input.actor,
        executor: tx,
      })

      didUploadFile = uploadResult.didUploadFile
      didReplaceFile = uploadResult.didReplaceFile
    })
  } else {
    await db.transaction(async (tx) => {
      if (hasObservationChange) {
        await updateChecklistItemObservation({
          checklistItem,
          nextObservation,
          actor: input.actor,
          executor: tx,
        })
      }

      if (shouldMarkOkWithoutFile) {
        await markChecklistItemOkWithoutFile({
          checklistItem,
          actor: input.actor,
          executor: tx,
        })
      }

      if (shouldUnmarkOkWithoutFile) {
        await unmarkChecklistItemOkWithoutFile({
          checklistItem,
          actor: input.actor,
          executor: tx,
        })
      }
    })
  }

  const checklist = await getProcessChecklist(input.processId)
  const currentProcess = await syncProcessStatusAfterChecklistChange({
    processId: input.processId,
    actor: input.actor,
    checklist,
  })

  return {
    ...checklist,
    message: getChecklistSubmitSuccessMessage({
      hasObservationChange,
      markOkWithoutFile: shouldMarkOkWithoutFile,
      unmarkedOkWithoutFile: shouldUnmarkOkWithoutFile,
      replacedFile: didReplaceFile,
      uploadedFile: didUploadFile,
    }),
    process: currentProcess,
  }
}

export async function uploadProcessChecklistFile(input: {
  processId: string
  processDocumentId: string
  file: File
  actor: ProcessActor
}) {
  return {
    ...(await submitProcessChecklistItem({
      processId: input.processId,
      processDocumentId: input.processDocumentId,
      file: input.file,
      actor: input.actor,
    })),
  }
}

export async function getProcessChecklistFileDownload(input: {
  processId: string
  processDocumentId: string
  fileId: string
}) {
  const fileRecord = await getChecklistFileOrThrow(input)
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

  return {
    file: {
      id: fileRecord.id,
      processDocumentId: fileRecord.processDocumentId,
      originalFileName: fileRecord.originalFileName,
      mimeType: fileRecord.mimeType,
      sizeInBytes: fileRecord.sizeInBytes,
      revision: fileRecord.revision,
      uploadedAt: fileRecord.uploadedAt,
      uploadedBy: fileRecord.uploadedBy,
    },
    downloadUrl,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  }
}
