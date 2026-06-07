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
import { normalizeCpf } from '../../shared/utils/cpf'
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

// Colunas do processo que o OCR pode preencher (mesmas keys produzidas pelo
// normalizer da extracao).
const OCR_FIELD_COLUMNS = [
  'fullName',
  'birthDate',
  'cpf',
  'rg',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'state',
  'zipcode',
] as const

type OcrFieldColumn = (typeof OCR_FIELD_COLUMNS)[number]

// Aplica os campos extraidos APENAS em colunas vazias do rascunho (nao
// destrutivo e idempotente em retry). Retorna se o processo passou a ter
// identidade (nome ou CPF), usado para decidir o status quando ha 0 documentos.
async function applyExtractedFieldsToDraft(
  processId: string,
  fields: Array<{ key: string; value: string; valid: boolean }>,
): Promise<{ hasIdentity: boolean }> {
  const current = await getProcessRecordOrThrow(processId)
  const allowed = new Set<string>(OCR_FIELD_COLUMNS)
  const update: Partial<Record<OcrFieldColumn, string>> = {}

  for (const field of fields) {
    if (!allowed.has(field.key)) continue
    const column = field.key as OcrFieldColumn
    // birthDate (coluna date) e cpf (identidade) so se forem validos — evita
    // gravar dado invalido e promover o rascunho a CADASTRADO com lixo.
    if ((column === 'birthDate' || column === 'cpf') && !field.valid) continue

    const currentValue = current[column]
    const isEmpty = column === 'birthDate' ? currentValue == null : currentValue === ''
    if (!isEmpty) continue

    update[column] = column === 'cpf' ? normalizeCpf(field.value) : field.value
  }

  if (Object.keys(update).length > 0) {
    await db.update(process).set(update).where(eq(process.id, processId))
  }

  const fullName = update.fullName ?? current.fullName
  const cpf = update.cpf ?? current.cpf
  return { hasIdentity: Boolean(fullName) || Boolean(cpf) }
}

// Ingestao OCR em background: extrai campos + classifica, preenche o rascunho,
// desmembra/anexa e define o status final por completude. NUNCA lanca: grava o
// resultado em splitStatus/splitMessage.
async function runOcrIngestion(input: {
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

    const { fields, documents } = await extractDocumentsFromFiles([file])

    // Best-effort: aplicar campos extraidos nao pode derrubar o anexo dos docs.
    let hasIdentity = false
    try {
      const applied = await applyExtractedFieldsToDraft(input.processId, fields)
      hasIdentity = applied.hasIdentity
    } catch (error) {
      console.error('OCR: falha ao aplicar campos no rascunho', {
        processId: input.processId,
        error: String(error),
      })
    }

    const result = await importDocumentBundle({
      processId: input.processId,
      file,
      documents,
      actor: input.actor,
      perms: input.perms,
    })

    // Com >=1 anexo, o status ja avancou (sync por-arquivo). Com 0 anexos, o
    // sync nao roda: decidimos explicitamente.
    if (result.attached.length === 0) {
      // Documentos reconhecidos mas nenhum anexado: registra o motivo p/ diagnostico.
      if (result.skipped.length > 0) {
        console.error('OCR: documentos reconhecidos mas nenhum anexado', {
          processId: input.processId,
          skipped: result.skipped,
        })
      }

      const current = await getProcessRecordOrThrow(input.processId)
      if (current.status === 'RASCUNHO' && hasIdentity) {
        await db
          .update(process)
          .set({ status: 'CADASTRADO' })
          .where(eq(process.id, input.processId))

        await createProcessHistoryEntry({
          processId: input.processId,
          actorUserId: input.actor.id,
          eventType: 'STATUS_CHANGED',
          fromStatus: 'RASCUNHO',
          toStatus: 'CADASTRADO',
          notes: 'Dados extraidos por OCR; nenhum documento foi separado.',
        })

        await setSplitStatus(
          fileRecord.id,
          'done',
          'Dados extraidos. Nenhum documento foi separado — anexe manualmente.',
        )
        return
      }

      await setSplitStatus(
        fileRecord.id,
        'done',
        'Nada foi reconhecido no documento. Refaca a captura.',
      )
      return
    }

    await setSplitStatus(fileRecord.id, 'done', result.message)
  } catch (error) {
    const message =
      error instanceof ServiceError
        ? error.message
        : 'Nao foi possivel processar o documento.'
    console.error('Falha na ingestao OCR', {
      fileId: fileRecord.id,
      error: String(error),
    })
    await setSplitStatus(fileRecord.id, 'error', message)
  }
}

// Armazena o scan no lote (como fonte) e dispara a ingestao OCR em background.
// Gated por 'create' na rota. Retorna o id do arquivo p/ o front acompanhar.
export async function startOcrIngestion(input: {
  processId: string
  file: File
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  assertBatchFile(input.file)

  if (input.file.type.toLowerCase() !== 'application/pdf') {
    throw new ProcessServiceError(
      415,
      'Apenas arquivos PDF podem ser processados.',
    )
  }

  const fileId = crypto.randomUUID()
  const bucketName = storageBuckets.processDocuments
  const objectKey = buildProcessBatchObjectKey({
    processId: input.processId,
    fileId,
    fileName: input.file.name,
  })
  const fileBytes = new Uint8Array(await input.file.arrayBuffer())

  try {
    await uploadStorageObject({
      bucketName,
      objectKey,
      contentType: 'application/pdf',
      body: fileBytes,
    })
  } catch {
    throw new ProcessServiceError(
      503,
      'Nao foi possivel enviar o documento para o storage. Tente novamente.',
    )
  }

  let fileRecord: typeof processBatchFile.$inferSelect
  try {
    const [inserted] = await db
      .insert(processBatchFile)
      .values({
        id: fileId,
        processId: input.processId,
        bucketName,
        objectKey,
        originalFileName: input.file.name,
        mimeType: 'application/pdf',
        sizeInBytes: input.file.size,
        uploadedByUserId: input.actor.id,
        splitStatus: 'processing',
        splitUpdatedAt: new Date(),
      })
      .returning()
    fileRecord = inserted
  } catch (error) {
    try {
      await deleteStorageObject({ bucketName, objectKey })
    } catch {
      // cleanup best-effort
    }
    throw error
  }

  // Dispara sem await: o trabalho continua apos a resposta HTTP.
  void runOcrIngestion({
    processId: input.processId,
    fileRecord,
    actor: input.actor,
    perms: input.perms,
  })

  return { batchFileId: fileRecord.id }
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
