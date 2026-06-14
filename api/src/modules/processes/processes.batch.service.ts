import { and, asc, eq, lt, ne, or } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import {
  buildImportStagingObjectKey,
  buildProcessBatchObjectKey,
  buildStorageObjectKey,
  copyStorageObject,
  createStorageObjectDownloadUrl,
  createStorageObjectUploadUrl,
  deleteStorageObject,
  getStorageObjectBytes,
  headStorageObject,
  readStorageObjectPrefix,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import { createStorageObjectsZip } from '../../shared/storage/zip'
import type { AppBindings } from '../../shared/types/app'
import { normalizeCpf } from '../../shared/utils/cpf'
import { buildBatchDownloadFileName } from '../../shared/utils/file-name'
import { user } from '../auth/auth.schema'
import { enqueueQuitacaoCheck } from '../caixa-quitacao/caixa-quitacao.service'
import {
  assertCanAccessBatch,
  assertCanAccessDocumentation,
  assertProcessAction,
  resolveUserPermissions,
} from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import { reconcileProcessShadow } from './derive/reconcile'
import {
  getProcessContextOrThrow,
  getProcessRecordOrThrow,
} from './processes.access'
import { assertChecklistUploadAllowed } from './processes.checklist.service'
import { ProcessServiceError } from './processes.errors'
import { recordDocumentExtractionAudit } from './processes.extraction.audit'
import { extractDocumentsFromFiles } from './processes.extraction.service'
import { createProcessHistoryEntry } from './processes.history.service'
import { importDocumentBundle } from './processes.import.service'
import {
  deadLetterIngestion,
  enqueueIngestion,
  failIngestion,
  INGESTION_HEARTBEAT_MS,
  INGESTION_MAX_DELIVERIES,
  type IngestionJob,
  markIngestionDone,
  renewIngestionLease,
} from './processes.ingestion.queue'
import { countPdfPages } from './processes.pdf.splitter'
import { process, processBatchFile } from './processes.schema'
import type { ProcessStatus } from './processes.status'

// Estas funcoes so usam o id do ator (usuario autenticado OU bot do sistema na
// ingestao). Tipar so o id permite passar { id } sem cast e o compilador garante
// que ninguem leia outro campo de um ator que nao o tem.
type ProcessActor = Pick<NonNullable<AppBindings['Variables']['user']>, 'id'>

export const maxBatchFileSizeInBytes = 25 * 1024 * 1024

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
    .set({
      splitStatus: 'processing',
      splitMessage: null,
      splitUpdatedAt: new Date(),
    })
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

    const file = new File(
      [new Uint8Array(bytes)],
      fileRecord.originalFileName,
      {
        type: 'application/pdf',
      },
    )

    // 1 chamada de IA: classifica as paginas (os campos titular/endereco sao ignorados aqui).
    const startedAt = Date.now()
    const { documents, meta } = await extractDocumentsFromFiles([file])

    const result = await importDocumentBundle({
      processId: input.processId,
      file,
      documents,
      actor: input.actor,
      perms: input.perms,
    })

    // Auditoria (ai_analysis): registra a classificacao da IA + a decisao de anexo.
    await recordDocumentExtractionAudit({
      processId: input.processId,
      fileId: fileRecord.id,
      totalPages: await countPdfPages(bytes),
      meta,
      outcome: result,
      durationMs: Date.now() - startedAt,
      triggeredByUserId: input.actor.id,
    })

    // SHADOW (v3): grava evidencia da derivacao; NAO altera estado. Best-effort.
    void reconcileProcessShadow(input.processId)

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

// Colunas do processo que o digitalizacao pode preencher (mesmas keys produzidas pelo
// normalizer da extracao).
const SCAN_FIELD_COLUMNS = [
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
  // Conjuge (do termo de entrega): spouseContractSigned='sim' + dados.
  'spouseContractSigned',
  'spouseSameAddress',
  'spouseFullName',
  'spouseCpf',
  'spouseBirthDate',
] as const

type ScanFieldColumn = (typeof SCAN_FIELD_COLUMNS)[number]

// Aplica os campos extraidos APENAS em colunas vazias do rascunho (nao
// destrutivo e idempotente em retry). Retorna se o processo passou a ter
// identidade (nome ou CPF), usado para decidir o status quando ha 0 documentos.
async function applyExtractedFieldsToDraft(
  processId: string,
  fields: Array<{ key: string; value: string; valid: boolean }>,
): Promise<{ hasIdentity: boolean }> {
  const current = await getProcessRecordOrThrow(processId)
  const allowed = new Set<string>(SCAN_FIELD_COLUMNS)
  const update: Partial<Record<ScanFieldColumn, string>> = {}

  // Colunas date (so aceitam data valida) e colunas de CPF (normalizadas).
  const dateColumns = new Set<string>(['birthDate', 'spouseBirthDate'])
  const cpfColumns = new Set<string>(['cpf', 'spouseCpf'])

  for (const field of fields) {
    if (!allowed.has(field.key)) continue
    const column = field.key as ScanFieldColumn
    // Campos de data, CPF e CEP so se forem validos — evita gravar dado invalido e
    // promover o rascunho com lixo. O campo invalido ainda aparece na revisao com
    // warning.
    if (
      (dateColumns.has(column) ||
        cpfColumns.has(column) ||
        column === 'zipcode') &&
      !field.valid
    ) {
      continue
    }

    // Campos do titular sao notNull (default '') — vazio = ''. Campos do conjuge
    // sao nullable — vazio = null. Trata os dois.
    const currentValue = current[column]
    const isEmpty = currentValue == null || currentValue === ''
    if (!isEmpty) continue

    update[column] = cpfColumns.has(column)
      ? normalizeCpf(field.value)
      : field.value
  }

  if (Object.keys(update).length > 0) {
    await db.update(process).set(update).where(eq(process.id, processId))
  }

  const fullName = update.fullName ?? current.fullName
  const cpf = update.cpf ?? current.cpf
  // Com o CPF extraido, dispara a consulta automatica de quitacao (worker RPA).
  await enqueueQuitacaoCheck(processId, cpf)
  return { hasIdentity: Boolean(fullName) || Boolean(cpf) }
}

// Trabalho PURO da ingestao digitalizacao: extrai campos + classifica, preenche o
// rascunho, desmembra/anexa e decide o status final por completude. Retorna a
// mensagem de desfecho (sucesso) ou LANCA em falha. NAO grava splitStatus — quem
// chama mapeia para splitStatus (inline) ou para a fila (worker).
async function runIngestionWork(input: {
  processId: string
  fileRecord: typeof processBatchFile.$inferSelect
  actor: ProcessActor
  perms: ResolvedPermissions
}): Promise<string> {
  const { fileRecord } = input

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

  const startedAt = Date.now()
  const { fields, documents, meta } = await extractDocumentsFromFiles([file])

  // Best-effort: aplicar campos extraidos nao pode derrubar o anexo dos docs.
  let hasIdentity = false
  try {
    const applied = await applyExtractedFieldsToDraft(input.processId, fields)
    hasIdentity = applied.hasIdentity
  } catch (error) {
    console.error('digitalizacao: falha ao aplicar campos no rascunho', {
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

  // Auditoria (ai_analysis): registra a classificacao da IA + a decisao de anexo.
  // Vale inclusive com 0 anexos — e justamente o caso de misclassificacao.
  await recordDocumentExtractionAudit({
    processId: input.processId,
    fileId: fileRecord.id,
    totalPages: await countPdfPages(bytes),
    meta,
    outcome: result,
    durationMs: Date.now() - startedAt,
    triggeredByUserId: input.actor.id,
  })

  // SHADOW (v3): grava evidencia da derivacao; NAO altera estado. Best-effort.
  void reconcileProcessShadow(input.processId)

  // Com >=1 anexo, o status ja avancou (sync por-arquivo). Com 0 anexos, o
  // sync nao roda: decidimos explicitamente.
  if (result.attached.length === 0) {
    // Documentos reconhecidos mas nenhum anexado: registra o motivo p/ diagnostico.
    if (result.skipped.length > 0) {
      console.error(
        'digitalizacao: documentos reconhecidos mas nenhum anexado',
        {
          processId: input.processId,
          skipped: result.skipped,
        },
      )
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
        notes:
          'Dados extraidos por digitalizacao; nenhum documento foi separado.',
      })

      return 'Dados extraidos. Nenhum documento foi separado — anexe manualmente.'
    }

    return 'Nada foi reconhecido no documento. Refaca a captura.'
  }

  return result.message
}

// Processa um job reivindicado da FILA (worker, Fase 2). Reconstroi actor/perms do
// usuario que fez o upload (a autorizacao ja ocorreu no enqueue, na rota), roda o
// trabalho com heartbeat do lease e grava o desfecho via primitivas da fila
// (done | retry com backoff | dead-letter). NUNCA lanca.
export async function processClaimedIngestion(
  job: IngestionJob,
): Promise<void> {
  // Backstop de ENTREGAS: reivindicado vezes demais sem concluir nem registrar
  // falha — assinatura de crash-poison (um PDF que derruba o worker, ex.: OOM,
  // antes do failIngestion). Dead-letter SEM processar: processar de novo
  // re-executaria o mesmo PDF que mata o worker. Fecha o gap de re-claim infinito.
  if (job.deliveryCount >= INGESTION_MAX_DELIVERIES) {
    const applied = await deadLetterIngestion(
      job.batchFileId,
      job.leaseToken,
      `Entregas excederam o limite (${INGESTION_MAX_DELIVERIES}) sem concluir — arquivo possivelmente derruba o worker.`,
    )
    if (!applied) {
      console.warn(
        'worker: lease perdido antes do backstop de entregas (outra replica assumiu)',
        { batchFileId: job.batchFileId },
      )
    }
    return
  }

  const [fileRecord] = await db
    .select()
    .from(processBatchFile)
    .where(eq(processBatchFile.id, job.batchFileId))
    .limit(1)

  if (!fileRecord) {
    // Linha sumiu (processo deletado entre enqueue e claim): encerra sem retry.
    await markIngestionDone(
      job.batchFileId,
      job.leaseToken,
      'Arquivo inexistente.',
    )
    return
  }

  // Heartbeat: renova o lease enquanto processa, para um job longo (IA) nao ser
  // considerado orfao e reivindicado em duplicidade. O fencing token garante que,
  // se o lease for perdido, a conclusao deste worker vira no-op (nao sobrescreve).
  const heartbeat = setInterval(() => {
    void renewIngestionLease(job.batchFileId, job.leaseToken)
  }, INGESTION_HEARTBEAT_MS)

  try {
    const [uploader] = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, fileRecord.uploadedByUserId))
      .limit(1)

    if (!uploader) {
      throw new ProcessServiceError(404, 'Usuario do upload nao encontrado.')
    }

    const perms = await resolveUserPermissions(uploader.id, uploader.role)
    const actor: ProcessActor = { id: uploader.id }

    const message = await runIngestionWork({
      processId: fileRecord.processId,
      fileRecord,
      actor,
      perms,
    })
    const applied = await markIngestionDone(
      job.batchFileId,
      job.leaseToken,
      message,
    )
    if (!applied) {
      // Lease perdido enquanto processava: outro worker reivindicou o orfao e ja
      // concluiu. Descartamos este desfecho (o fencing impediu a sobrescrita).
      console.warn(
        'worker: lease perdido apos concluir; desfecho descartado (outra replica assumiu)',
        { batchFileId: job.batchFileId },
      )
    }
  } catch (error) {
    const message =
      error instanceof ServiceError
        ? error.message
        : 'Nao foi possivel processar o documento.'
    console.error('Falha na ingestao (worker)', {
      batchFileId: job.batchFileId,
      deliveryCount: job.deliveryCount,
      failureCount: job.failureCount,
      error: String(error),
    })
    const applied = await failIngestion(
      job.batchFileId,
      job.leaseToken,
      job.failureCount,
      message,
    )
    if (!applied) {
      console.warn(
        'worker: lease perdido apos falha; retry/dead-letter nao aplicado (outra replica assumiu)',
        { batchFileId: job.batchFileId },
      )
    }
  } finally {
    clearInterval(heartbeat)
  }
}

// Armazena o scan no lote (como fonte) e dispara a ingestao digitalizacao em background.
// Gated por 'create' na rota. Retorna o id do arquivo p/ o front acompanhar.
// Guarda UM arquivo no lote (S3 + processBatchFile 'processing'), pronto para a
// ingestao. Nao dispara o trabalho — quem chama decide (single ou multi).
async function storeIngestionFile(input: {
  processId: string
  file: File
  actor: ProcessActor
}): Promise<typeof processBatchFile.$inferSelect> {
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
        // Entra na fila duravel: o worker reivindica (claim+lease) e processa.
        splitStatus: 'queued',
        splitUpdatedAt: new Date(),
      })
      .returning()
    return inserted
  } catch (error) {
    try {
      await deleteStorageObject({ bucketName, objectKey })
    } catch {
      // cleanup best-effort
    }
    throw error
  }
}

export async function startScanIngestion(input: {
  processId: string
  file: File
  actor: ProcessActor
  perms: ResolvedPermissions
}) {
  const fileRecord = await storeIngestionFile({
    processId: input.processId,
    file: input.file,
    actor: input.actor,
  })

  // O arquivo ja entra como 'queued' (storeIngestionFile); o worker reivindica e
  // processa em background. Retorna imediato — o front acompanha por splitStatus.
  return { batchFileId: fileRecord.id }
}

// Reprocessa a ingestao dos arquivos que FALHARAM (splitStatus='error') de um
// processo — re-roda a ingestao COMPLETA (extrai + aplica campos + split) a
// partir do PDF JÁ no lote, SEM re-upload. Continuidade quando a IA falha.
export async function reprocessFailedIngestion(input: {
  processId: string
  actor: ProcessActor
  perms: ResolvedPermissions
}): Promise<{ count: number }> {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  assertCanAccessBatch(input.perms, relationship)
  assertCanAccessDocumentation(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'uploadChecklist')
  assertChecklistUploadAllowed(currentProcess.status)

  const errorFiles = await db
    .select()
    .from(processBatchFile)
    .where(
      and(
        eq(processBatchFile.processId, input.processId),
        eq(processBatchFile.splitStatus, 'error'),
      ),
    )

  if (errorFiles.length === 0) {
    throw new ProcessServiceError(
      400,
      'Nao ha documentos com falha para reprocessar.',
    )
  }

  // Re-enfileira os que falharam: enqueueIngestion reseta para 'queued' e zera
  // tentativas/lease/dead-letter; o worker reivindica e processa.
  for (const fileRecord of errorFiles) {
    await enqueueIngestion(fileRecord.id)
  }

  return { count: errorFiles.length }
}

const MAX_IMPORT_FILES = 20

// Assinatura de arquivo PDF: "%PDF-".
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

function hasPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) {
    return false
  }
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) {
      return false
    }
  }
  return true
}

// Gera URLs pre-assinadas de UPLOAD: o browser sobe cada PDF DIRETO no S3 (sem
// passar pela API — contorna o teto de 10MB do API Gateway). O upload vai para
// uma area de STAGING com lifecycle (objetos abandonados expiram sozinhos); o
// complete copia para o local definitivo. O tamanho e ASSINADO na URL (o S3
// rejeita um corpo maior), e o tipo/conteudo sao validados no complete.
export async function presignDocumentUploads(input: {
  processId: string
  files: Array<{ fileName: string; contentType: string; size: number }>
}): Promise<{
  uploads: Array<{ fileId: string; objectKey: string; uploadUrl: string }>
}> {
  if (input.files.length === 0) {
    throw new ProcessServiceError(400, 'Informe ao menos um arquivo.')
  }
  if (input.files.length > MAX_IMPORT_FILES) {
    throw new ProcessServiceError(
      400,
      `Maximo de ${MAX_IMPORT_FILES} arquivos por envio.`,
    )
  }

  const uploads: Array<{
    fileId: string
    objectKey: string
    uploadUrl: string
  }> = []
  for (const file of input.files) {
    if (file.contentType.toLowerCase() !== 'application/pdf') {
      throw new ProcessServiceError(415, `"${file.fileName}": envie um PDF.`)
    }
    if (file.size <= 0 || file.size > maxBatchFileSizeInBytes) {
      throw new ProcessServiceError(
        413,
        `"${file.fileName}" excede o limite de 25 MB.`,
      )
    }

    const fileId = crypto.randomUUID()
    const objectKey = buildImportStagingObjectKey({
      processId: input.processId,
      fileId,
      fileName: file.fileName,
    })
    const uploadUrl = await createStorageObjectUploadUrl({
      bucketName: storageBuckets.processDocuments,
      objectKey,
      contentType: 'application/pdf',
      // Trava o tamanho do PUT no valor declarado (<=25MB ja validado acima).
      contentLength: file.size,
    })
    uploads.push({ fileId, objectKey, uploadUrl })
  }

  return { uploads }
}

// Conclui o import pre-assinado: valida (dono + chave exata do staging + objeto
// existe + tamanho real + assinatura PDF), move do staging para o local
// definitivo, registra no lote e dispara a ingestao SEQUENCIAL.
export async function completeDocumentImport(input: {
  processId: string
  files: Array<{ fileId: string; objectKey: string; fileName: string }>
  actor: ProcessActor
  perms: ResolvedPermissions
}): Promise<{ batchFileIds: string[] }> {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  assertCanAccessBatch(input.perms, relationship)
  assertCanAccessDocumentation(input.perms, relationship)
  assertProcessAction(input.perms, relationship, 'uploadChecklist')
  assertChecklistUploadAllowed(currentProcess.status)

  if (input.files.length === 0) {
    throw new ProcessServiceError(400, 'Nenhum arquivo para concluir.')
  }

  const bucketName = storageBuckets.processDocuments
  const fileRecords: Array<typeof processBatchFile.$inferSelect> = []
  for (const file of input.files) {
    // Seguranca: a chave precisa ser EXATAMENTE a que o presign geraria para
    // este (processId, fileId, fileName) — nunca uma chave arbitraria, e o
    // fileId fica amarrado ao objeto (nao apenas ao prefixo /batch/).
    const stagingKey = buildImportStagingObjectKey({
      processId: input.processId,
      fileId: file.fileId,
      fileName: file.fileName,
    })
    if (file.objectKey !== stagingKey) {
      throw new ProcessServiceError(400, 'Chave de objeto invalida.')
    }

    const head = await headStorageObject({ bucketName, objectKey: stagingKey })
    if (!head) {
      throw new ProcessServiceError(
        400,
        `O upload de "${file.fileName}" nao foi encontrado (pode ja ter sido importado).`,
      )
    }
    if (head.sizeInBytes > maxBatchFileSizeInBytes) {
      await deleteStorageObject({ bucketName, objectKey: stagingKey }).catch(
        () => {},
      )
      throw new ProcessServiceError(
        413,
        `"${file.fileName}" excede o limite de 25 MB.`,
      )
    }

    // Confere a assinatura PDF (magic bytes) — a API nao viu o arquivo passar.
    const prefix = await readStorageObjectPrefix({
      bucketName,
      objectKey: stagingKey,
      length: PDF_MAGIC.length,
    })
    if (!hasPdfSignature(prefix)) {
      await deleteStorageObject({ bucketName, objectKey: stagingKey }).catch(
        () => {},
      )
      throw new ProcessServiceError(
        415,
        `"${file.fileName}" nao e um PDF valido.`,
      )
    }

    // Move do staging para o local definitivo (copy server-side).
    const batchKey = buildProcessBatchObjectKey({
      processId: input.processId,
      fileId: file.fileId,
      fileName: file.fileName,
    })
    await copyStorageObject({
      bucketName,
      sourceObjectKey: stagingKey,
      destinationObjectKey: batchKey,
    })

    // Insert protegido: replay/corrida (PK ou objectKey unico) vira 409 limpo,
    // nao um 500. Em falha, desfaz a copia definitiva.
    try {
      const [inserted] = await db
        .insert(processBatchFile)
        .values({
          id: file.fileId,
          processId: input.processId,
          bucketName,
          objectKey: batchKey,
          originalFileName: file.fileName,
          mimeType: 'application/pdf',
          sizeInBytes: head.sizeInBytes,
          uploadedByUserId: input.actor.id,
          // Entra na fila duravel: o worker reivindica e processa.
          splitStatus: 'queued',
          splitUpdatedAt: new Date(),
        })
        .returning()
      fileRecords.push(inserted)
    } catch {
      await deleteStorageObject({ bucketName, objectKey: batchKey }).catch(
        () => {},
      )
      throw new ProcessServiceError(409, `"${file.fileName}" ja foi importado.`)
    }

    // Sucesso: remove o staging (a copia definitiva ja existe). Se falhar, o
    // lifecycle do prefixo de staging limpa depois.
    await deleteStorageObject({ bucketName, objectKey: stagingKey }).catch(
      () => {},
    )
  }

  // Os arquivos ja entram como 'queued'; o worker reivindica e processa.

  return { batchFileIds: fileRecords.map((record) => record.id) }
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

// ZIP unico com todos os arquivos do lote (download unico — evita o bloqueio de
// multiplos downloads do navegador e CORS por arquivo das URLs assinadas).
export async function downloadAllBatchFilesZip(
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
      bucketName: processBatchFile.bucketName,
      objectKey: processBatchFile.objectKey,
      originalFileName: processBatchFile.originalFileName,
    })
    .from(processBatchFile)
    .where(eq(processBatchFile.processId, processId))
    .orderBy(asc(processBatchFile.uploadedAt))

  const entries = files.map((file) => ({
    bucketName: file.bucketName,
    objectKey: file.objectKey,
    fileName: buildBatchDownloadFileName({
      processCode: currentProcess.code,
      processFullName: currentProcess.fullName,
      originalFileName: file.originalFileName,
    }),
  }))

  const bytes = await createStorageObjectsZip(entries)
  const zipFileName = `lote-${currentProcess.code}.zip`.replace(/\s+/g, '-')

  // Sobe o ZIP no storage e devolve URL assinada (download direto do S3, fora da
  // API) — evita o "Request Entity Too Large" do gateway em ZIPs grandes.
  const bucketName = storageBuckets.processDocuments
  // Artefato efemero: key unica num prefixo dedicado (expira por lifecycle).
  const objectKey = buildStorageObjectKey([
    'tmp-zips',
    `${crypto.randomUUID()}-${zipFileName}`,
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
