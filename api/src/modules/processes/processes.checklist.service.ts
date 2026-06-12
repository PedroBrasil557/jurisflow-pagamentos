import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildProcessDocumentObjectKey,
  buildStorageObjectKey,
  createStorageObjectDownloadUrl,
  deleteStorageObject,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import { createStorageObjectsZip } from '../../shared/storage/zip'
import type { AppBindings } from '../../shared/types/app'
import { buildChecklistDownloadFileName } from '../../shared/utils/file-name'
import { user } from '../auth/auth.schema'
import {
  getHousingComplexChecklistFiles,
  type HousingComplexChecklistFile,
} from '../housing-complexes/housing-complexes.documents.service'
import {
  assertCanAccessChecklist,
  assertCanAccessDocumentation,
  assertProcessAction,
} from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import {
  getProcessContextOrThrow,
  getProcessRecordOrThrow,
} from './processes.access'
import {
  isCaixaOwnerDocKey,
  startCaixaOwnerAnalysis,
} from './processes.caixa-owner.service'
import {
  conditionalProcessDocumentTypes,
  defaultProcessDocumentTypes,
  documentDisplayNumberByKey,
  documentLabelByKey,
  isHousingComplexDocument,
} from './processes.documents'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  isProcuracaoDocKey,
  startProcuracaoConjuntoAnalysis,
} from './processes.procuracao-conjunto.service'
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
  'RASCUNHO',
  'CADASTRADO',
  'EM_LOTE',
  'EM_DOCUMENTACAO',
  'DOCUMENTACAO_PRONTA',
] as const satisfies readonly ProcessStatus[]

function isChecklistUploadAllowed(currentStatus: ProcessStatus): boolean {
  return checklistUploadAllowedStatuses.includes(
    currentStatus as (typeof checklistUploadAllowedStatuses)[number],
  )
}

export function assertChecklistUploadAllowed(currentStatus: ProcessStatus) {
  if (isChecklistUploadAllowed(currentStatus)) {
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
      label: processDocumentType.label,
      sortOrder: processDocumentType.sortOrder,
      isRequired: processDocumentType.isRequired,
      allowsMultipleFiles: processDocumentType.allowsMultipleFiles,
      isActive: processDocumentType.isActive,
    })
    .from(processDocumentType)

  const existingByKey = new Map(existingTypes.map((item) => [item.key, item]))
  const allDocumentTypes = [
    ...defaultProcessDocumentTypes,
    ...conditionalProcessDocumentTypes,
  ]
  const missingTypes = allDocumentTypes.filter(
    (documentType) => !existingByKey.has(documentType.key),
  )

  if (missingTypes.length > 0) {
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

  // Reconcile metadata for types that already exist but drifted from code.
  // Keeps the DB in sync with processes.documents.ts (source of truth) when a
  // label/order/required flag changes — e.g. converting a conditional+required
  // document into an always-visible optional one.
  for (const documentType of allDocumentTypes) {
    const existing = existingByKey.get(documentType.key)
    if (!existing) {
      continue
    }

    const hasChanged =
      existing.label !== documentType.label ||
      existing.sortOrder !== documentType.sortOrder ||
      existing.isRequired !== documentType.isRequired ||
      existing.allowsMultipleFiles !== documentType.allowsMultipleFiles ||
      existing.isActive !== true

    if (!hasChanged) {
      continue
    }

    await db
      .update(processDocumentType)
      .set({
        label: documentType.label,
        sortOrder: documentType.sortOrder,
        isRequired: documentType.isRequired,
        allowsMultipleFiles: documentType.allowsMultipleFiles,
        isActive: true,
      })
      .where(eq(processDocumentType.key, documentType.key))
  }

  // Deactivate document types that were removed from code
  const activeCodeKeys = new Set<string>(allDocumentTypes.map((d) => d.key))
  const removedKeys: string[] = existingTypes
    .map((t) => t.key)
    .filter((key) => !activeCodeKeys.has(key))

  if (removedKeys.length > 0) {
    await db
      .update(processDocumentType)
      .set({ isActive: false })
      .where(
        and(
          inArray(processDocumentType.key, removedKeys),
          eq(processDocumentType.isActive, true),
        ),
      )
  }
}

function getConditionalDocumentKeys(
  processFields: Record<string, unknown>,
): Set<string> {
  const keys = new Set<string>()

  for (const docType of conditionalProcessDocumentTypes) {
    const fieldValue = processFields[docType.condition.field]

    if (fieldValue === docType.condition.value) {
      keys.add(docType.key)
    }
  }

  return keys
}

export async function ensureProcessChecklistItems(processId: string) {
  await getProcessRecordOrThrow(processId)

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

  await db
    .insert(processDocument)
    .values(
      missingItems.map((documentType) => ({
        id: crypto.randomUUID(),
        processId,
        documentTypeId: documentType.id,
        status: 'PENDENTE' as const,
        observation: '',
      })),
    )
    // Blinda contra corrida: chamadas concorrentes nao colidem no indice unico
    // (processId, documentTypeId).
    .onConflictDoNothing({
      target: [processDocument.processId, processDocument.documentTypeId],
    })
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

type ChecklistResponseFile = {
  id: string
  processDocumentId: string
  originalFileName: string
  mimeType: string
  sizeInBytes: number
  revision: number | null
  uploadedAt: Date
  uploadedBy: { id: string; name: string; role: string }
  source: 'process' | 'housing_complex'
  downloadUrl: string | null
}

function buildChecklistResponse(input: {
  checklistItems: Awaited<ReturnType<typeof listChecklistItems>>
  currentFiles: ChecklistFileRecord
  housingComplexId: string | null
  housingComplexFiles: Map<string, HousingComplexChecklistFile>
}) {
  const currentFilesByChecklistItemId = groupCurrentFilesByChecklistItemId(
    input.currentFiles,
  )

  const items = input.checklistItems.map((checklistItem) => {
    const key = checklistItem.documentType.key
    const scope = isHousingComplexDocument(key) ? 'housing_complex' : 'process'

    // Arquivos do processo (legado/normais).
    const processFiles: ChecklistResponseFile[] = (
      currentFilesByChecklistItemId.get(checklistItem.id) ?? []
    ).map((file) => ({
      id: file.id,
      processDocumentId: file.processDocumentId,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeInBytes: file.sizeInBytes,
      revision: file.revision,
      uploadedAt: file.uploadedAt,
      uploadedBy: file.uploadedBy,
      source: 'process',
      downloadUrl: null,
    }))

    let currentFiles = processFiles
    let housingComplexLinked = true

    if (scope === 'housing_complex') {
      housingComplexLinked = input.housingComplexId !== null
      const conjuntoFile = input.housingComplexFiles.get(key)

      if (conjuntoFile) {
        // Espelho do conjunto na frente; arquivos legados do processo contam como
        // fallback (nada se perde do que ja foi anexado por processo).
        currentFiles = [
          {
            id: conjuntoFile.id,
            processDocumentId: checklistItem.id,
            originalFileName: conjuntoFile.originalFileName,
            mimeType: conjuntoFile.mimeType,
            sizeInBytes: conjuntoFile.sizeInBytes,
            revision: null,
            uploadedAt: conjuntoFile.uploadedAt,
            uploadedBy: conjuntoFile.uploadedBy,
            source: 'housing_complex',
            downloadUrl: conjuntoFile.downloadUrl,
          },
          ...processFiles,
        ]
      }
    }

    return {
      id: checklistItem.id,
      // Itens do conjunto sao read-only e seu processDocument.status nunca e
      // atualizado (o arquivo vive em housingComplexFile). Deriva o status pela
      // presenca do arquivo espelhado, para o badge nao ficar "Pendente" eterno.
      status:
        scope === 'housing_complex'
          ? currentFiles.length > 0
            ? 'ANEXADO'
            : 'PENDENTE'
          : checklistItem.status,
      observation: checklistItem.observation,
      scope,
      readOnly: scope === 'housing_complex',
      housingComplexLinked,
      documentType: {
        ...checklistItem.documentType,
        number: documentDisplayNumberByKey.get(key) ?? null,
        scope,
      },
      currentFiles,
    }
  })

  // Itens de conjunto sem conjunto vinculado nao contam como obrigatorios (nao ha
  // como anexar) — ficam visiveis/pendentes com aviso, mas nao travam a completude.
  const requiredItems = items.filter(
    (item) =>
      item.documentType.isRequired &&
      !(item.scope === 'housing_complex' && !item.housingComplexLinked),
  )
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
      // O vinculo do conjunto e pre-requisito de completude: um processo nao pode
      // ficar "documentacao pronta" sem conjunto (os docs de escopo de conjunto sao
      // obrigatorios para a peticao). A UI usa isto para sinalizar o bloqueio.
      housingComplexLinked: input.housingComplexId !== null,
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
    documentTypeSortOrder: input.checklistItem.documentType.sortOrder,
    documentTypeLabel: input.checklistItem.documentType.label,
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

// Anexo em CONTEXTO DE SISTEMA (sem permissao de usuario): usado pelo worker de
// consulta de quitacao para anexar o PDF baixado da Caixa ao slot do checklist.
// Reusa o core attachChecklistFile (ator = usuario tecnico jurisflow-bot) e
// dispara a mesma cadeia do anexo manual (analise do titular para termos Caixa).
// Reconcilia o status ao final: na automacao, o anexo de sistema (worker de
// quitacao -> declaracao_quitacao) costuma ser o ULTIMO obrigatorio, completando a
// documentacao — o backend e dono do avanco para DOCUMENTACAO_PRONTA, qualquer
// origem.
export async function attachSystemChecklistFile(input: {
  processId: string
  documentTypeKey: string
  file: File
}): Promise<{ didUploadFile: boolean }> {
  await ensureProcessChecklistItems(input.processId)

  const [doc] = await db
    .select({ id: processDocument.id })
    .from(processDocument)
    .innerJoin(
      processDocumentType,
      eq(processDocument.documentTypeId, processDocumentType.id),
    )
    .where(
      and(
        eq(processDocument.processId, input.processId),
        eq(processDocumentType.key, input.documentTypeKey),
      ),
    )
    .limit(1)

  if (!doc) {
    throw new ProcessServiceError(
      404,
      'Item do checklist nao encontrado para o documento.',
    )
  }

  const checklistItem = await getChecklistItemOrThrow(input.processId, doc.id)

  // Contexto de sistema: se o processo nao esta numa etapa que aceita anexos
  // (EM_PROCESSO/FINALIZADO/CANCELADO), PULA silenciosamente — nao lanca (evita
  // retry infinito do worker) e nao dispara a analise do titular.
  if (!isChecklistUploadAllowed(checklistItem.processStatus)) {
    console.warn(
      `[caixa-quitacao] anexo de sistema ignorado: processo ${input.processId} em ${checklistItem.processStatus} nao aceita anexos`,
    )
    return { didUploadFile: false }
  }

  // Apenas o id e usado por attachChecklistFile (uploadedByUserId/actorUserId).
  const actor = { id: 'jurisflow-bot' } as unknown as ProcessActor

  let didUploadFile = false
  await db.transaction(async (tx) => {
    const result = await attachChecklistFile({
      checklistItem,
      file: input.file,
      actor,
      executor: tx,
    })
    didUploadFile = result.didUploadFile
  })

  if (didUploadFile && isCaixaOwnerDocKey(input.documentTypeKey)) {
    // Fire-and-forget: nunca deixar a Promise rejeitar sem tratamento (o claim
    // faz I/O no banco) — uma rejeicao nao capturada vira unhandledRejection.
    startCaixaOwnerAnalysis({
      processId: input.processId,
      triggeredByUserId: null,
    }).catch((error) => {
      console.error(
        '[caixa-owner] falha ao disparar analise (anexo de sistema):',
        error,
      )
    })
  }

  if (didUploadFile) {
    // Reconcilia o status: o anexo de sistema pode ter completado a documentacao
    // obrigatoria (auto-avanco para DOCUMENTACAO_PRONTA). Ator = bot do sistema.
    await reconcileProcessStatus(input.processId, actor)
  }

  return { didUploadFile }
}

// Reconciliador de status por completude do checklist: carrega o checklist e
// sincroniza. Ponto UNICO para "recomputar o estado do processo" a partir de
// qualquer origem (worker de ingestao/quitacao, script de backfill, re-sync de
// conjunto). Idempotente. O backend e dono do avanco de estado.
export async function reconcileProcessStatus(
  processId: string,
  actor: ProcessActor,
) {
  const currentProcess = await getProcessRecordOrThrow(processId)
  const checklist = await loadProcessChecklistData(currentProcess)
  return syncProcessStatusAfterChecklistChange({ processId, actor, checklist })
}

export async function syncProcessStatusAfterChecklistChange(input: {
  actor: ProcessActor
  checklist: Awaited<ReturnType<typeof getProcessChecklist>>
  processId: string
}) {
  const currentProcess = await getProcessRecordOrThrow(input.processId)

  // Only auto-sync for early/mid statuses. RASCUNHO (entrada do digitalizacao) avanca por
  // completude; EM_LOTE (legado) ainda drena por aqui.
  const syncableStatuses: ProcessStatus[] = [
    'RASCUNHO',
    'CADASTRADO',
    'EM_LOTE',
    'EM_DOCUMENTACAO',
    'DOCUMENTACAO_PRONTA',
  ]

  if (!syncableStatuses.includes(currentProcess.status)) {
    return currentProcess
  }

  // Count only from visible (filtered) checklist items
  const visibleFileCount = input.checklist.items.reduce(
    (sum, item) => sum + item.currentFiles.length,
    0,
  )
  const hasOkWithoutFile = input.checklist.items.some(
    (item) => item.status === 'OK_SEM_ARQUIVO',
  )
  const hasIndividualDocs = visibleFileCount > 0 || hasOkWithoutFile

  // EM_LOTE deixou de ser produzido: o status avanca apenas por completude do
  // checklist (anexo via lote, digitalizacao ou upload avulso leva a EM_DOCUMENTACAO).
  let targetStatus: ProcessStatus = hasIndividualDocs
    ? 'EM_DOCUMENTACAO'
    : 'CADASTRADO'

  // Auto-avanco para DOCUMENTACAO_PRONTA quando a documentacao obrigatoria esta
  // completa. O BACKEND e dono deste avanco — dispara para QUALQUER origem
  // (digitalizacao por worker, anexo de doc de conjunto, upload humano), sem
  // depender do frontend. So a partir de EM_DOCUMENTACAO (predecessor legal):
  // CADASTRADO sem docs nunca tem requiredPending===0 com hasIndividualDocs.
  //
  // PRE-REQUISITO: conjunto VINCULADO. Sem conjunto, os docs de escopo de conjunto
  // sao excluidos dos obrigatorios (nao ha onde anexar) — entao requiredPending
  // pode chegar a 0 sem eles. Travar o avanco aqui impede que um processo sem
  // conjunto fique "pronto" pulando docs obrigatorios da peticao. O caso fica em
  // EM_DOCUMENTACAO aguardando o vinculo (procuracao no import, ou humano no edge).
  //
  // So avanca a partir do status ATUAL EM_DOCUMENTACAO (predecessor legal de
  // DOCUMENTACAO_PRONTA). Chavear no currentProcess.status — NAO no targetStatus
  // computado — evita salto ilegal (ex.: CADASTRADO->PRONTA) ao gravar via raw
  // update sem passar pela tabela de transicoes. Um CADASTRADO completo vai antes
  // para EM_DOCUMENTACAO e so entao, no proximo reconcile, para PRONTA.
  if (
    currentProcess.status === 'EM_DOCUMENTACAO' &&
    input.checklist.summary.requiredPending === 0 &&
    currentProcess.housingComplexId !== null
  ) {
    targetStatus = 'DOCUMENTACAO_PRONTA'
  }

  // Sai de DOCUMENTACAO_PRONTA se a documentacao voltou a ficar pendente OU se o
  // conjunto deixou de estar vinculado (pre-requisito): reverte para EM_DOCUMENTACAO.
  if (
    currentProcess.status === 'DOCUMENTACAO_PRONTA' &&
    (input.checklist.summary.requiredPending > 0 ||
      currentProcess.housingComplexId === null)
  ) {
    targetStatus = 'EM_DOCUMENTACAO'
  }

  // Ja PRONTA, completo E com conjunto vinculado: sem mudanca.
  if (
    currentProcess.status === 'DOCUMENTACAO_PRONTA' &&
    input.checklist.summary.requiredPending === 0 &&
    currentProcess.housingComplexId !== null
  ) {
    return currentProcess
  }

  // If already at the right status, no change
  if (targetStatus === currentProcess.status) {
    return currentProcess
  }

  const extraValues: Record<string, unknown> = {}
  if (targetStatus === 'DOCUMENTACAO_PRONTA') {
    extraValues.documentationReadyAt = new Date()
  } else if (currentProcess.status === 'DOCUMENTACAO_PRONTA') {
    // Saindo de PRONTA (documentacao voltou a ficar pendente).
    extraValues.documentationReadyAt = null
  }

  // update + historico na MESMA transacao: a auditoria nao pode divergir do estado.
  const updatedProcess = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(process)
      .set({
        status: targetStatus,
        ...extraValues,
      })
      .where(eq(process.id, input.processId))
      .returning()

    await createProcessHistoryEntry({
      processId: input.processId,
      actorUserId: input.actor.id,
      eventType: 'STATUS_CHANGED',
      fromStatus: currentProcess.status,
      toStatus: targetStatus,
      notes:
        targetStatus === 'CADASTRADO'
          ? 'Todos os documentos foram removidos.'
          : targetStatus === 'DOCUMENTACAO_PRONTA'
            ? 'Documentacao concluida automaticamente.'
            : targetStatus === 'EM_DOCUMENTACAO'
              ? 'Documentacao voltou a ficar pendente.'
              : undefined,
      executor: tx,
    })

    return updated
  })

  return updatedProcess
}

// Monta o checklist do processo SEM checagem de acesso (uso interno: getProcessChecklist
// adiciona o controle de acesso antes; o re-sync por conjunto chama direto).
async function loadProcessChecklistData(currentProcess: ProcessRecord) {
  await ensureProcessChecklistItems(currentProcess.id)

  const allConditionalKeys = new Set<string>(
    conditionalProcessDocumentTypes.map((d) => d.key),
  )
  const activeConditionalKeys = getConditionalDocumentKeys(currentProcess)

  const allChecklistItems = await listChecklistItems(currentProcess.id)

  // Filter out conditional items that don't apply to this process
  const checklistItems = allChecklistItems.filter((item) => {
    if (!allConditionalKeys.has(item.documentType.key)) {
      return true
    }

    return activeConditionalKeys.has(item.documentType.key)
  })

  const housingComplexId = currentProcess.housingComplexId ?? null

  const [currentFiles, housingComplexFiles] = await Promise.all([
    listCurrentChecklistFiles(checklistItems.map((item) => item.id)),
    housingComplexId
      ? getHousingComplexChecklistFiles(housingComplexId)
      : Promise.resolve(new Map<string, HousingComplexChecklistFile>()),
  ])

  return buildChecklistResponse({
    checklistItems,
    currentFiles,
    housingComplexId,
    housingComplexFiles,
  })
}

export async function getProcessChecklist(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId,
      userId,
      perms,
    })
  assertCanAccessChecklist(perms, relationship)

  return loadProcessChecklistData(currentProcess)
}

// Re-sincroniza o status de todos os processos de um conjunto. Chamado quando um
// documento do conjunto e anexado/removido — a completude desses processos muda
// sem que haja qualquer mutacao de checklist no proprio processo.
export async function syncProcessesForHousingComplex(input: {
  housingComplexId: string
  actor: ProcessActor
}) {
  const processes = await db
    .select({ id: process.id })
    .from(process)
    .where(eq(process.housingComplexId, input.housingComplexId))

  for (const { id } of processes) {
    const currentProcess = await getProcessRecordOrThrow(id)
    const checklist = await loadProcessChecklistData(currentProcess)
    await syncProcessStatusAfterChecklistChange({
      processId: id,
      checklist,
      actor: input.actor,
    })
  }
}

export async function submitProcessChecklistItem(input: {
  processId: string
  processDocumentId: string
  actor: ProcessActor
  perms: ResolvedPermissions
  file?: File | null
  markOkWithoutFile?: boolean
  observation?: string
}): Promise<ChecklistSubmitResult> {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  assertCanAccessDocumentation(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'uploadChecklist')

  const checklistItem = await getChecklistItemOrThrow(
    input.processId,
    input.processDocumentId,
  )

  if (currentProcess.id !== checklistItem.processId) {
    throw new ProcessServiceError(404, 'Item do checklist nao encontrado.')
  }

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

  // Documentos do conjunto sao gerenciados no cadastro do conjunto (somente admin).
  // No processo sao 100% somente leitura — bloqueia anexo, marcacao, desmarcacao
  // e ate edicao de observacao.
  if (isHousingComplexDocument(checklistItem.documentType.key)) {
    throw new ProcessServiceError(
      400,
      'Este documento e gerenciado no cadastro do conjunto, nao no processo.',
    )
  }

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

  const checklist = await getProcessChecklist(
    input.processId,
    input.actor.id,
    input.perms,
  )
  const updatedProcess = await syncProcessStatusAfterChecklistChange({
    processId: input.processId,
    actor: input.actor,
    checklist,
  })

  // Gatilho automatico: ao anexar/substituir um termo da Caixa, dispara a
  // analise do titular do contrato em background (nao bloqueia a resposta).
  if (didUploadFile && isCaixaOwnerDocKey(checklistItem.documentType.key)) {
    // Fire-and-forget protegido: rejeicao do claim/dispatch nao pode escapar
    // como unhandledRejection (nao ha handler global).
    startCaixaOwnerAnalysis({
      processId: input.processId,
      triggeredByUserId: input.actor.id,
    }).catch((error) => {
      console.error('[caixa-owner] falha ao disparar analise:', error)
    })
  }

  // Gatilho automatico: ao anexar a procuracao, dispara a analise do conjunto
  // (a partir do endereco do outorgante) em background.
  if (didUploadFile && isProcuracaoDocKey(checklistItem.documentType.key)) {
    startProcuracaoConjuntoAnalysis({
      processId: input.processId,
      triggeredByUserId: input.actor.id,
    }).catch((error) => {
      console.error('[procuracao-conjunto] falha ao disparar analise:', error)
    })
  }

  return {
    ...checklist,
    message: getChecklistSubmitSuccessMessage({
      hasObservationChange,
      markOkWithoutFile: shouldMarkOkWithoutFile,
      unmarkedOkWithoutFile: shouldUnmarkOkWithoutFile,
      replacedFile: didReplaceFile,
      uploadedFile: didUploadFile,
    }),
    process: updatedProcess,
  }
}

export async function uploadProcessChecklistFile(input: {
  processId: string
  processDocumentId: string
  file: File
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  return {
    ...(await submitProcessChecklistItem({
      processId: input.processId,
      processDocumentId: input.processDocumentId,
      file: input.file,
      actor: input.actor,
      perms: input.perms,
    })),
  }
}

export async function getProcessChecklistFileDownload(input: {
  processId: string
  processDocumentId: string
  fileId: string
  userId: string
  perms: ResolvedPermissions
}) {
  const { relationship } = await getProcessContextOrThrow({
    processId: input.processId,
    userId: input.userId,
    perms: input.perms,
  })
  assertCanAccessChecklist(input.perms, relationship)

  const [currentProcess, checklistItem, fileRecord] = await Promise.all([
    getProcessRecordOrThrow(input.processId),
    getChecklistItemOrThrow(input.processId, input.processDocumentId),
    getChecklistFileOrThrow(input),
  ])

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

  const downloadFileName = buildChecklistDownloadFileName({
    documentNumber:
      documentDisplayNumberByKey.get(checklistItem.documentType.key) ?? null,
    documentTypeLabel: checklistItem.documentType.label,
    processCode: currentProcess.code,
    processFullName: currentProcess.fullName,
    originalFileName: fileRecord.originalFileName,
  })

  return {
    file: {
      id: fileRecord.id,
      processDocumentId: fileRecord.processDocumentId,
      originalFileName: fileRecord.originalFileName,
      downloadFileName,
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

export async function deleteChecklistFile(input: {
  processId: string
  processDocumentId: string
  fileId: string
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  const { relationship } = await getProcessContextOrThrow({
    processId: input.processId,
    userId: input.actor.id,
    perms: input.perms,
  })
  assertCanAccessDocumentation(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'deleteChecklistFile')

  const checklistItem = await getChecklistItemOrThrow(
    input.processId,
    input.processDocumentId,
  )

  assertChecklistUploadAllowed(checklistItem.processStatus)

  const [fileRecord] = await db
    .select()
    .from(processDocumentFile)
    .where(
      and(
        eq(processDocumentFile.processDocumentId, input.processDocumentId),
        eq(processDocumentFile.id, input.fileId),
        eq(processDocumentFile.isCurrent, true),
      ),
    )
    .limit(1)

  if (!fileRecord) {
    throw new ProcessServiceError(404, 'Arquivo nao encontrado.')
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

  await db
    .delete(processDocumentFile)
    .where(eq(processDocumentFile.id, input.fileId))

  const [remainingFile] = await db
    .select({ id: processDocumentFile.id })
    .from(processDocumentFile)
    .where(
      and(
        eq(processDocumentFile.processDocumentId, input.processDocumentId),
        eq(processDocumentFile.isCurrent, true),
      ),
    )
    .limit(1)

  if (!remainingFile) {
    await db
      .update(processDocument)
      .set({ status: 'PENDENTE' })
      .where(eq(processDocument.id, input.processDocumentId))
  }

  await createProcessHistoryEntry({
    processId: input.processId,
    actorUserId: input.actor.id,
    eventType: 'DOCUMENT_DELETED',
    notes: `Arquivo removido: ${checklistItem.documentType.label} (${fileRecord.originalFileName}).`,
  })

  const checklist = await getProcessChecklist(
    input.processId,
    input.actor.id,
    input.perms,
  )
  const currentProcess = await syncProcessStatusAfterChecklistChange({
    processId: input.processId,
    actor: input.actor,
    checklist,
  })

  return {
    ...checklist,
    message: 'Arquivo removido com sucesso.',
    process: currentProcess,
  }
}

export async function downloadAllChecklistFiles(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
) {
  const { relationship } = await getProcessContextOrThrow({
    processId,
    userId,
    perms,
  })
  assertCanAccessChecklist(perms, relationship)

  const currentProcess = await getProcessRecordOrThrow(processId)

  const files = await db
    .select({
      id: processDocumentFile.id,
      bucketName: processDocumentFile.bucketName,
      objectKey: processDocumentFile.objectKey,
      originalFileName: processDocumentFile.originalFileName,
      documentTypeKey: processDocumentType.key,
      documentTypeLabel: processDocumentType.label,
    })
    .from(processDocumentFile)
    .innerJoin(
      processDocument,
      eq(processDocumentFile.processDocumentId, processDocument.id),
    )
    .innerJoin(
      processDocumentType,
      eq(processDocument.documentTypeId, processDocumentType.id),
    )
    .where(
      and(
        eq(processDocument.processId, processId),
        eq(processDocumentFile.isCurrent, true),
      ),
    )
    .orderBy(
      asc(processDocumentType.sortOrder),
      asc(processDocumentFile.uploadedAt),
    )

  const expiresInSeconds = 60 * 10
  const result = await Promise.all(
    files.map(async (file) => {
      const downloadUrl = await createStorageObjectDownloadUrl({
        bucketName: file.bucketName,
        objectKey: file.objectKey,
        expiresInSeconds,
      })

      const downloadFileName = buildChecklistDownloadFileName({
        documentNumber:
          documentDisplayNumberByKey.get(file.documentTypeKey) ?? null,
        documentTypeLabel: file.documentTypeLabel,
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

  // Inclui os documentos do conjunto (espelhados no checklist) no "baixar todos".
  if (currentProcess.housingComplexId) {
    const conjuntoFiles = await getHousingComplexChecklistFiles(
      currentProcess.housingComplexId,
    )
    for (const [key, file] of conjuntoFiles) {
      result.push({
        id: file.id,
        originalFileName: buildChecklistDownloadFileName({
          documentNumber: documentDisplayNumberByKey.get(key) ?? null,
          documentTypeLabel: documentLabelByKey.get(key) ?? key,
          processCode: currentProcess.code,
          processFullName: currentProcess.fullName,
          originalFileName: file.originalFileName,
        }),
        downloadUrl: file.downloadUrl,
      })
    }
  }

  return { files: result }
}

// Monta um ZIP unico com todos os documentos do checklist (processo + conjunto).
// Evita o "baixar todos" via N downloads — o navegador bloqueia downloads
// programaticos em sequencia e as URLs assinadas sao cross-origin em producao.
export async function downloadAllChecklistFilesZip(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
) {
  const { relationship } = await getProcessContextOrThrow({
    processId,
    userId,
    perms,
  })
  assertCanAccessChecklist(perms, relationship)

  const currentProcess = await getProcessRecordOrThrow(processId)

  const files = await db
    .select({
      bucketName: processDocumentFile.bucketName,
      objectKey: processDocumentFile.objectKey,
      originalFileName: processDocumentFile.originalFileName,
      documentTypeKey: processDocumentType.key,
      documentTypeLabel: processDocumentType.label,
    })
    .from(processDocumentFile)
    .innerJoin(
      processDocument,
      eq(processDocumentFile.processDocumentId, processDocument.id),
    )
    .innerJoin(
      processDocumentType,
      eq(processDocument.documentTypeId, processDocumentType.id),
    )
    .where(
      and(
        eq(processDocument.processId, processId),
        eq(processDocumentFile.isCurrent, true),
      ),
    )
    .orderBy(
      asc(processDocumentType.sortOrder),
      asc(processDocumentFile.uploadedAt),
    )

  // O contrato de honorarios advocaticios e interno do escritorio — nao faz
  // parte do pacote de documentos do processo, entao fica de fora do ZIP.
  const entries = files
    .filter(
      (file) => file.documentTypeKey !== 'contrato_honorarios_advocaticios',
    )
    .map((file) => ({
      bucketName: file.bucketName,
      objectKey: file.objectKey,
      fileName: buildChecklistDownloadFileName({
        documentNumber:
          documentDisplayNumberByKey.get(file.documentTypeKey) ?? null,
        documentTypeLabel: file.documentTypeLabel,
        processCode: currentProcess.code,
        processFullName: currentProcess.fullName,
        originalFileName: file.originalFileName,
      }),
    }))

  // Documentos do conjunto (espelhados no checklist).
  if (currentProcess.housingComplexId) {
    const conjuntoFiles = await getHousingComplexChecklistFiles(
      currentProcess.housingComplexId,
    )
    for (const [key, file] of conjuntoFiles) {
      entries.push({
        bucketName: file.bucketName,
        objectKey: file.objectKey,
        fileName: buildChecklistDownloadFileName({
          documentNumber: documentDisplayNumberByKey.get(key) ?? null,
          documentTypeLabel: documentLabelByKey.get(key) ?? key,
          processCode: currentProcess.code,
          processFullName: currentProcess.fullName,
          originalFileName: file.originalFileName,
        }),
      })
    }
  }

  const bytes = await createStorageObjectsZip(entries)
  // Nome do arquivo = nome do titular do processo (cai para o codigo se vazio).
  const holderName =
    (currentProcess.fullName ?? '').trim() || currentProcess.code
  const zipFileName = `${holderName}.zip`

  // Sobe o ZIP no storage e devolve URL assinada: o download vai do S3 direto ao
  // navegador, sem passar pela API (evita o limite de payload do gateway que
  // causava "Request Entity Too Large" em ZIPs grandes).
  const bucketName = storageBuckets.processDocuments
  // Artefato efemero: key unica num prefixo dedicado (expira por lifecycle).
  // A key unica tambem evita corrida entre downloads simultaneos do processo.
  const objectKey = buildStorageObjectKey([
    'tmp-zips',
    `${crypto.randomUUID()}-${zipFileName.replace(/\s+/g, '-')}`,
  ])
  await uploadStorageObject({
    body: new Uint8Array(bytes),
    bucketName,
    contentType: 'application/zip',
    objectKey,
  })
  const downloadUrl = await createStorageObjectDownloadUrl({
    bucketName,
    objectKey,
    downloadFileName: zipFileName,
  })

  return { downloadUrl, fileName: zipFileName, fileCount: entries.length }
}
