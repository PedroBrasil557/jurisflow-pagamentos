import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import { db } from '../../shared/db'
import { deleteStorageObject } from '../../shared/storage/s3'
import type { AppBindings } from '../../shared/types/app'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import {
  assertCan,
  assertCanAccessHistory,
  assertCanViewProcess,
  assertProcessAction,
  buildProcessRelationship,
} from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import {
  buildProcessVisibilityFilter,
  getProcessContextOrThrow,
  getProcessRecordOrThrow,
} from './processes.access'
import {
  ensureProcessChecklistItems,
  getProcessChecklist,
  reconcileProcessStatus,
  syncProcessStatusAfterChecklistChange,
} from './processes.checklist.service'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  type ProcessHistoryChangedFields,
  process,
  processBatchFile,
  processHistory,
} from './processes.schema'
import {
  type CancelProcessPayload,
  type CreateProcessPayload,
  type ListProcessesQuery,
  normalizeProcessPayload,
  type UpdateProcessPayload,
} from './processes.schemas'
import {
  canTransitionProcessStatus,
  isTerminalProcessStatus,
  type ProcessStatus,
} from './processes.status'

type ProcessActor = NonNullable<AppBindings['Variables']['user']>
type ProcessInsert = typeof process.$inferInsert
type ProcessRecord = typeof process.$inferSelect
type ProcessHistoryInsert = typeof processHistory.$inferInsert

const processEditableFieldKeys = [
  'fullName',
  'birthDate',
  'nationality',
  'maritalStatus',
  'profession',
  'ownerType',
  'cpf',
  'rg',
  'cadunico',
  'propertyPaidOff',
  'state',
  'city',
  'district',
  'housingComplex',
  'street',
  'number',
  'complement',
  'zipcode',
  'email',
  'whatsapp',
  'spouseContractSigned',
  'spouseFullName',
  'spouseBirthDate',
  'spouseNationality',
  'spouseMaritalStatus',
  'spouseProfession',
  'spouseCpf',
  'spouseRg',
  'spouseCadunico',
  'spouseSameAddress',
  'spouseState',
  'spouseCity',
  'spouseDistrict',
  'spouseHousingComplex',
  'spouseStreet',
  'spouseNumber',
  'spouseComplement',
  'spouseZipcode',
  'witness1Id',
  'witness2Id',
  'observation',
] as const

type ProcessEditableFieldKey = (typeof processEditableFieldKeys)[number]

type ProcessEditableValues = Pick<ProcessRecord, ProcessEditableFieldKey>
type ProcessListHistoryRecord = {
  processId: string
  eventType: ProcessHistoryInsert['eventType']
  fromStatus: ProcessStatus | null
  toStatus: ProcessStatus | null
  notes: string | null
  createdAt: Date
  actorName: string
}

function assertProcessCanBeEdited(currentProcess: ProcessRecord) {
  if (isTerminalProcessStatus(currentProcess.status)) {
    throw new ProcessServiceError(
      409,
      'Nao e possivel editar um processo finalizado ou cancelado.',
    )
  }
}

function assertValidStatusTransition(
  currentStatus: ProcessStatus,
  nextStatus: ProcessStatus,
) {
  if (!canTransitionProcessStatus(currentStatus, nextStatus)) {
    throw new ProcessServiceError(
      409,
      'A transicao de status solicitada nao e permitida.',
    )
  }
}

function buildProcessCode() {
  const now = new Date()
  const datePrefix = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()

  return `PROC-${datePrefix}-${suffix}`
}

async function resolveHousingComplexIdOrThrow(housingComplexName: string) {
  const normalizedName = housingComplexName.trim().toUpperCase()

  const [resolvedHousingComplex] = await db
    .select({
      id: housingComplex.id,
    })
    .from(housingComplex)
    .where(sql`upper(trim(${housingComplex.name})) = ${normalizedName}`)
    .limit(1)

  if (!resolvedHousingComplex) {
    throw new ProcessServiceError(
      400,
      'O conjunto habitacional informado nao esta cadastrado.',
    )
  }

  return resolvedHousingComplex.id
}

function getLegalProcessLabel(currentProcess: ProcessRecord) {
  switch (currentProcess.status) {
    case 'RASCUNHO':
      return 'Rascunho'
    case 'CADASTRADO':
      return 'Cadastrado'
    case 'EM_LOTE':
      return 'Em lote'
    case 'EM_DOCUMENTACAO':
      return 'Nao iniciado'
    case 'DOCUMENTACAO_PRONTA':
      return 'Pronto para advogado'
    case 'EM_PROCESSO':
      return 'Em processo'
    case 'FINALIZADO':
      return 'Finalizado'
    case 'CANCELADO':
      return 'Cancelado'
  }
}

function getHistoryEventLabel(historyEntry: ProcessListHistoryRecord) {
  switch (historyEntry.eventType) {
    case 'CREATED':
      return 'Processo criado'
    case 'UPDATED':
      return 'Dados atualizados'
    case 'CANCELLED':
      return 'Processo cancelado'
    case 'PDF_GENERATED':
      return 'PDF gerado'
    case 'DOCUMENT_UPLOADED':
      return 'Documento anexado'
    case 'DOCUMENT_REPLACED':
      return 'Documento substituido'
    case 'DOCUMENT_DELETED':
      return 'Documento removido'
    case 'DOCUMENT_MARKED_OK_WITHOUT_FILE':
      return 'Documento marcado como ok'
    case 'DOCUMENT_UNMARKED_OK_WITHOUT_FILE':
      return 'Ok sem arquivo desmarcado'
    case 'DOCUMENT_OBSERVATION_UPDATED':
      return 'Observacao do documento atualizada'
    case 'BATCH_UPLOADED':
      return 'Arquivos enviados em lote'
    case 'BATCH_DELETED':
      return 'Arquivo em lote removido'
    case 'DOCUMENTATION_ASSIGNEE_SET':
      return 'Responsavel pela documentacao designado'
    case 'DOCUMENTATION_ASSIGNEE_REMOVED':
      return 'Responsavel pela documentacao removido'
    case 'STATUS_CHANGED':
      switch (historyEntry.toStatus) {
        case 'CADASTRADO':
          return 'Retornou para cadastrado'
        case 'EM_LOTE':
          return 'Arquivos em lote enviados'
        case 'EM_DOCUMENTACAO':
          return 'Documentacao reaberta'
        case 'DOCUMENTACAO_PRONTA':
          return 'Documentacao pronta'
        case 'EM_PROCESSO':
          return 'Processo iniciado'
        case 'FINALIZADO':
          return 'Processo finalizado'
        case 'CANCELADO':
          return 'Processo cancelado'
        default:
          return 'Status atualizado'
      }
  }
}

function pickEditableValues(
  currentProcess: ProcessRecord,
): ProcessEditableValues {
  return {
    fullName: currentProcess.fullName,
    birthDate: currentProcess.birthDate ?? '',
    nationality: currentProcess.nationality,
    maritalStatus: currentProcess.maritalStatus,
    profession: currentProcess.profession,
    ownerType: currentProcess.ownerType,
    cpf: currentProcess.cpf,
    rg: currentProcess.rg,
    cadunico: currentProcess.cadunico,
    propertyPaidOff: currentProcess.propertyPaidOff,
    state: currentProcess.state,
    city: currentProcess.city,
    district: currentProcess.district,
    housingComplex: currentProcess.housingComplex,
    street: currentProcess.street,
    number: currentProcess.number,
    complement: currentProcess.complement,
    zipcode: currentProcess.zipcode,
    email: currentProcess.email,
    whatsapp: currentProcess.whatsapp,
    spouseContractSigned: currentProcess.spouseContractSigned ?? '',
    spouseFullName: currentProcess.spouseFullName ?? '',
    spouseBirthDate: currentProcess.spouseBirthDate ?? '',
    spouseNationality: currentProcess.spouseNationality ?? '',
    spouseMaritalStatus: currentProcess.spouseMaritalStatus ?? '',
    spouseProfession: currentProcess.spouseProfession ?? '',
    spouseCpf: currentProcess.spouseCpf ?? '',
    spouseRg: currentProcess.spouseRg ?? '',
    spouseCadunico: currentProcess.spouseCadunico ?? '',
    spouseSameAddress: currentProcess.spouseSameAddress ?? '',
    spouseState: currentProcess.spouseState ?? '',
    spouseCity: currentProcess.spouseCity ?? '',
    spouseDistrict: currentProcess.spouseDistrict ?? '',
    spouseHousingComplex: currentProcess.spouseHousingComplex ?? '',
    spouseStreet: currentProcess.spouseStreet ?? '',
    spouseNumber: currentProcess.spouseNumber ?? '',
    spouseComplement: currentProcess.spouseComplement ?? '',
    spouseZipcode: currentProcess.spouseZipcode ?? '',
    witness1Id: currentProcess.witness1Id ?? '',
    witness2Id: currentProcess.witness2Id ?? '',
    observation: currentProcess.observation,
  }
}

function buildChangedFields(
  currentValues: ProcessEditableValues,
  nextValues: ProcessEditableValues,
) {
  const changedFields: ProcessHistoryChangedFields = {}

  for (const fieldKey of processEditableFieldKeys) {
    if (currentValues[fieldKey] === nextValues[fieldKey]) {
      continue
    }

    changedFields[fieldKey] = {
      before: currentValues[fieldKey],
      after: nextValues[fieldKey],
    }
  }

  return changedFields
}

export async function getProcessOrThrow(processId: string) {
  return getProcessRecordOrThrow(processId)
}

async function updateProcessStatus(input: {
  processId: string
  actor: ProcessActor
  nextStatus: ProcessStatus
  eventType: ProcessHistoryInsert['eventType']
  notes?: string | null
  extraValues?: Partial<ProcessInsert>
}) {
  const currentProcess = await getProcessOrThrow(input.processId)

  assertValidStatusTransition(currentProcess.status, input.nextStatus)

  return await db.transaction(async (tx) => {
    const [updatedProcess] = await tx
      .update(process)
      .set({
        status: input.nextStatus,
        ...input.extraValues,
      })
      .where(eq(process.id, input.processId))
      .returning()

    await createProcessHistoryEntry({
      processId: input.processId,
      actorUserId: input.actor.id,
      eventType: input.eventType,
      fromStatus: currentProcess.status,
      toStatus: input.nextStatus,
      notes: input.notes ?? null,
      executor: tx,
    })

    return updatedProcess
  })
}

// "Revisar classificacao": existe uma auditoria document_extraction com algo que
// pede acao humana —
//  (a) um doc reconhecido pulou um item de checklist OBRIGATORIO+ATIVO ainda
//      PENDENTE (skip benigno — ex.: compra_venda do titular, que nem existe no
//      checklist dele — nao casa);
//  (b) ha pagina classificada como nao_identificado; ou
//  (c) a IA OMITIU paginas (totalPages real > classifiedPages).
// Derivado, sem estado novo, e AUTO-CURA: anexou o doc -> item deixa de ser
// PENDENTE -> o processo sai do filtro. Auditorias antigas (@1, sem totalPages)
// nao disparam (c) por causa do coalesce.
function buildClassificationReviewFilter() {
  return sql`EXISTS (
    SELECT 1 FROM ai_analysis a
    WHERE a.process_id = ${process.id}
      AND a.kind = 'document_extraction'
      AND (
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(a.decision->'skipped', '[]'::jsonb)) s
          JOIN process_document pd ON pd.process_id = a.process_id
          JOIN process_document_type dt ON dt.id = pd.document_type_id
          WHERE dt.key = s->>'documentTypeKey'
            AND dt.is_required AND dt.is_active
            AND pd.status = 'PENDENTE'
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(a.output->'paginas', '[]'::jsonb)) pg
          WHERE pg->>'tipo' = 'nao_identificado'
        )
        OR coalesce((a.input->>'totalPages')::int, 0)
             > coalesce((a.input->>'classifiedPages')::int, 0)
      )
  )`
}

export async function listProcesses(
  query: ListProcessesQuery,
  userId: string,
  perms: ResolvedPermissions,
) {
  const filters = []

  const visibilityFilter = buildProcessVisibilityFilter(userId, perms)
  if (visibilityFilter) {
    filters.push(visibilityFilter)
  }

  if (query.statuses?.length) {
    filters.push(inArray(process.status, query.statuses))
  } else if (query.status) {
    filters.push(eq(process.status, query.status))
  }

  if (query.ownerTypes?.length) {
    filters.push(inArray(process.ownerType, query.ownerTypes))
  }

  if (query.housingComplexIds?.length) {
    filters.push(inArray(process.housingComplexId, query.housingComplexIds))
  }

  if (query.createdFrom) {
    filters.push(gte(process.createdAt, query.createdFrom))
  }

  if (query.createdTo) {
    const endOfDay = new Date(query.createdTo)
    endOfDay.setHours(23, 59, 59, 999)
    filters.push(lte(process.createdAt, endOfDay))
  }

  if (query.search) {
    const searchTerm = `%${query.search}%`

    filters.push(
      or(
        ilike(process.code, searchTerm),
        ilike(process.fullName, searchTerm),
        ilike(process.cpf, searchTerm),
        ilike(process.city, searchTerm),
        ilike(process.housingComplex, searchTerm),
      ),
    )
  }

  if (query.needsClassificationReview) {
    filters.push(buildClassificationReviewFilter())
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined
  const offset = (query.page - 1) * query.limit

  const [items, [summary]] = await Promise.all([
    db
      .select()
      .from(process)
      .where(whereClause)
      .orderBy(desc(process.createdAt))
      .limit(query.limit)
      .offset(offset),
    db
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(process)
      .where(whereClause),
  ])

  if (items.length === 0) {
    return {
      items: [],
      pagination: {
        page: query.page,
        limit: query.limit,
        total: summary?.total ?? 0,
      },
    }
  }

  const processIds = items.map((item) => item.id)
  const assignedAttorneyIds = [
    ...new Set(
      items
        .map((item) => item.assignedAttorneyId)
        .filter((value): value is string => Boolean(value)),
    ),
  ]

  const [attorneys, historyEntries, batchStatuses] = await Promise.all([
    assignedAttorneyIds.length > 0
      ? db
          .select({
            id: user.id,
            name: user.name,
          })
          .from(user)
          .where(inArray(user.id, assignedAttorneyIds))
      : Promise.resolve([]),
    db
      .select({
        processId: processHistory.processId,
        eventType: processHistory.eventType,
        fromStatus: processHistory.fromStatus,
        toStatus: processHistory.toStatus,
        notes: processHistory.notes,
        createdAt: processHistory.createdAt,
        actorName: user.name,
      })
      .from(processHistory)
      .innerJoin(user, eq(processHistory.actorUserId, user.id))
      .where(inArray(processHistory.processId, processIds))
      .orderBy(desc(processHistory.createdAt)),
    // Estado da ingestao de documentos por processo (lote): para o badge da
    // lista — "processando" tem prioridade sobre "falhou".
    db
      .select({
        processId: processBatchFile.processId,
        hasProcessing: sql<boolean>`bool_or(${processBatchFile.splitStatus} = 'processing')`,
        hasError: sql<boolean>`bool_or(${processBatchFile.splitStatus} = 'error')`,
      })
      .from(processBatchFile)
      .where(inArray(processBatchFile.processId, processIds))
      .groupBy(processBatchFile.processId),
  ])

  const attorneysById = new Map(attorneys.map((item) => [item.id, item.name]))
  const ingestionByProcessId = new Map<string, 'processing' | 'error'>()
  for (const row of batchStatuses) {
    if (row.hasProcessing) {
      ingestionByProcessId.set(row.processId, 'processing')
    } else if (row.hasError) {
      ingestionByProcessId.set(row.processId, 'error')
    }
  }
  const latestHistoryByProcessId = new Map<string, ProcessListHistoryRecord>()

  for (const historyEntry of historyEntries) {
    if (!latestHistoryByProcessId.has(historyEntry.processId)) {
      latestHistoryByProcessId.set(historyEntry.processId, historyEntry)
    }
  }

  return {
    items: items.map((item) => {
      const relationship = buildProcessRelationship(item, userId, perms)
      const assignedAttorneyName = item.assignedAttorneyId
        ? (attorneysById.get(item.assignedAttorneyId) ?? null)
        : null
      const lastMovement = latestHistoryByProcessId.get(item.id)

      return {
        id: item.id,
        code: item.code,
        status: item.status,
        fullName: item.fullName,
        cpf: item.cpf,
        city: item.city,
        state: item.state,
        housingComplex: item.housingComplex,
        district: item.district,
        relationship,
        ingestionStatus: ingestionByProcessId.get(item.id) ?? null,
        legalProcess: {
          label: getLegalProcessLabel(item),
          attorneyName: assignedAttorneyName,
          number: item.legalProcessNumber,
          causeValue: item.causeValue,
          protocolDate: item.protocolDate,
        },
        lastMovement: lastMovement
          ? {
              label: getHistoryEventLabel(lastMovement),
              actorName: lastMovement.actorName,
              notes: lastMovement.notes,
              createdAt: lastMovement.createdAt,
            }
          : null,
        createdAt: item.createdAt,
      }
    }),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: summary?.total ?? 0,
    },
  }
}

export async function getProcessById(
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

  assertCanViewProcess(perms, relationship)

  let documentationAssigneeName: string | null = null
  if (currentProcess.documentationAssigneeId) {
    const [assignee] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, currentProcess.documentationAssigneeId))
      .limit(1)
    documentationAssigneeName = assignee?.name ?? null
  }

  return {
    ...currentProcess,
    documentationAssigneeName,
  }
}

export async function getProcessHistory(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
  options?: { cursor?: string; limit?: number },
) {
  const { relationship } = await getProcessContextOrThrow({
    processId,
    userId,
    perms,
  })
  assertCanAccessHistory(perms, relationship)

  const limit = Math.min(options?.limit ?? 20, 50)
  const conditions = [eq(processHistory.processId, processId)]

  if (options?.cursor) {
    conditions.push(lt(processHistory.createdAt, new Date(options.cursor)))
  }

  const items = await db
    .select({
      id: processHistory.id,
      eventType: processHistory.eventType,
      fromStatus: processHistory.fromStatus,
      toStatus: processHistory.toStatus,
      changedFields: processHistory.changedFields,
      notes: processHistory.notes,
      createdAt: processHistory.createdAt,
      actor: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
    .from(processHistory)
    .innerJoin(user, eq(processHistory.actorUserId, user.id))
    .where(and(...conditions))
    .orderBy(desc(processHistory.createdAt))
    .limit(limit + 1)

  const hasMore = items.length > limit
  const pageItems = hasMore ? items.slice(0, limit) : items
  const nextCursor = hasMore
    ? pageItems[pageItems.length - 1].createdAt.toISOString()
    : null

  return { items: pageItems, nextCursor }
}

export async function createProcess(
  payload: CreateProcessPayload,
  actor: ProcessActor,
  perms: ResolvedPermissions,
) {
  assertCan(perms, 'create')

  const processId = crypto.randomUUID()
  const processCode = buildProcessCode()
  const housingComplexId = await resolveHousingComplexIdOrThrow(
    payload.housingComplex,
  )

  const [createdProcess] = await db
    .insert(process)
    .values({
      id: processId,
      code: processCode,
      status: 'CADASTRADO',
      createdByUserId: actor.id,
      assignedAttorneyId: null,
      documentationReadyAt: null,
      startedAt: null,
      finalizedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      housingComplexId,
      ...payload,
      witness1Id: null,
      witness2Id: null,
    })
    .returning()

  await createProcessHistoryEntry({
    processId,
    actorUserId: actor.id,
    eventType: 'CREATED',
    toStatus: createdProcess.status,
    notes: 'Processo criado.',
  })

  await ensureProcessChecklistItems(processId)

  // A quitacao NAO e enfileirada aqui (v3): a fila so nasce quando o reconciliador
  // conhece o(s) titular(es) do contrato Caixa (apos a derivacao). Enfileirar com o
  // process.cpf na criacao consultaria o CPF errado no caso nao_titular.

  return createdProcess
}

// Cria um processo RASCUNHO (entrada do fluxo digitalizacao): registro-casca com defaults
// vazios, sem passar pelo schema de criacao (os dados chegam depois, da IA).
export async function createDraftProcess(
  actor: ProcessActor,
  perms: ResolvedPermissions,
) {
  assertCan(perms, 'create')

  const processId = crypto.randomUUID()
  const processCode = buildProcessCode()

  const [createdProcess] = await db
    .insert(process)
    .values({
      id: processId,
      code: processCode,
      status: 'RASCUNHO',
      createdByUserId: actor.id,
      fullName: '',
      birthDate: null,
      nationality: '',
      maritalStatus: '',
      profession: '',
      ownerType: '',
      cpf: '',
      rg: '',
      cadunico: '',
      propertyPaidOff: '',
      state: '',
      city: '',
      district: '',
      housingComplex: '',
      street: '',
      number: '',
      complement: '',
      zipcode: '',
      email: '',
      whatsapp: '',
      observation: '',
      housingComplexId: null,
    })
    .returning()

  // Sem transacao nativa aqui: se as escritas seguintes falharem, removemos o
  // processo recem-criado para nao deixar um rascunho orfao sem checklist.
  try {
    await createProcessHistoryEntry({
      processId,
      actorUserId: actor.id,
      eventType: 'CREATED',
      toStatus: createdProcess.status,
      notes: 'Rascunho criado via digitalizacao.',
    })

    await ensureProcessChecklistItems(processId)
  } catch (error) {
    await db
      .delete(process)
      .where(eq(process.id, processId))
      .catch(() => {})
    throw error
  }

  return createdProcess
}

// Remove um processo e limpa os objetos do scan no storage (o cascade do banco
// remove historico/checklist/lote, mas nao os arquivos no S3). Usado no rollback
// do fluxo digitalizacao quando a ingestao nao pode ser iniciada.
export async function deleteProcess(processId: string) {
  const batchFiles = await db
    .select({
      bucketName: processBatchFile.bucketName,
      objectKey: processBatchFile.objectKey,
    })
    .from(processBatchFile)
    .where(eq(processBatchFile.processId, processId))

  for (const batchFile of batchFiles) {
    try {
      await deleteStorageObject({
        bucketName: batchFile.bucketName,
        objectKey: batchFile.objectKey,
      })
    } catch (error) {
      console.error('Falha ao remover objeto do storage no rollback', {
        processId,
        error: String(error),
      })
    }
  }

  await db.delete(process).where(eq(process.id, processId))
}

export async function updateProcess(
  processId: string,
  payload: UpdateProcessPayload,
  actor: ProcessActor,
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship: rel } =
    await getProcessContextOrThrow({
      processId,
      userId: actor.id,
      perms,
    })

  assertProcessCanBeEdited(currentProcess)
  assertProcessAction(perms, rel, 'edit')

  const currentValues = pickEditableValues(currentProcess)
  const mergedValues = normalizeProcessPayload({
    ...currentValues,
    ...payload,
  })
  const normalizedWitnessValues = {
    witness1Id: mergedValues.witness1Id || null,
    witness2Id: mergedValues.witness2Id || null,
  }
  const changedFields = buildChangedFields(currentValues, mergedValues)

  if (Object.keys(changedFields).length === 0) {
    return currentProcess
  }

  const housingComplexId = await resolveHousingComplexIdOrThrow(
    mergedValues.housingComplex,
  )

  const [updatedProcess] = await db
    .update(process)
    .set({
      ...mergedValues,
      ...normalizedWitnessValues,
      housingComplexId,
      // Edicao manual do ownerType marca a fonte como 'human' — assim a analise
      // automatica (caixa-owner) respeita o human-lock e nao sobrescreve a
      // escolha do usuario numa reanalise posterior.
      ...(changedFields.ownerType ? { ownerTypeSource: 'human' } : {}),
      // Idem para o housingComplex (conjunto): edicao manual trava contra a
      // analise da procuracao (vira alerta de divergencia, nao sobrescreve).
      ...(changedFields.housingComplex
        ? { housingComplexSource: 'human' }
        : {}),
    })
    .where(eq(process.id, processId))
    .returning()

  await createProcessHistoryEntry({
    processId,
    actorUserId: actor.id,
    eventType: 'UPDATED',
    changedFields,
    notes: 'Campos do processo atualizados.',
  })

  if (
    changedFields.ownerType ||
    changedFields.spouseContractSigned ||
    changedFields.propertyPaidOff ||
    // Vincular/mudar o conjunto altera a obrigatoriedade dos docs de conjunto e o
    // pre-requisito de completude (resolucao humana do caso "conjunto cadastrado
    // depois") — reconcilia o status.
    changedFields.housingComplex
  ) {
    // O reconciliador le tudo fresco (status + checklist); nao monta snapshot aqui.
    return syncProcessStatusAfterChecklistChange({ processId, actor })
  }

  return updatedProcess
}

export async function markProcessDocumentationReady(
  processId: string,
  actor: ProcessActor,
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship: rel } =
    await getProcessContextOrThrow({
      processId,
      userId: actor.id,
      perms,
    })
  assertProcessAction(perms, rel, 'markDocumentationReady')

  // Idempotente: o backend ja auto-avanca para DOCUMENTACAO_PRONTA quando completa.
  if (currentProcess.status === 'DOCUMENTACAO_PRONTA') {
    return currentProcess
  }

  // DELEGA ao reconciliador — fonte UNICA de verdade do "pode ser PRONTA"
  // (documentacao obrigatoria completa E conjunto vinculado). NAO reimplementa o
  // predicado aqui, para os dois caminhos (auto e manual) nunca divergirem.
  const updated = await reconcileProcessStatus(processId, actor)

  if (updated.status !== 'DOCUMENTACAO_PRONTA') {
    // Nao avancou: explica o motivo (mesma regra do reconciliador).
    const checklist = await getProcessChecklist(processId, actor.id, perms)
    if (checklist.summary.requiredPending > 0) {
      throw new ProcessServiceError(
        409,
        'Ainda existem documentos obrigatorios pendentes para este processo.',
      )
    }
    if (updated.housingComplexId === null) {
      throw new ProcessServiceError(
        409,
        'Vincule o conjunto habitacional antes de concluir a documentacao.',
      )
    }
    throw new ProcessServiceError(
      409,
      'A documentacao ainda nao pode ser concluida.',
    )
  }

  return updated
}

export async function startProcess(
  processId: string,
  actor: ProcessActor,
  payload: {
    legalProcessNumber: string
    causeValue: string
    protocolDate: string
  },
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship: rel } =
    await getProcessContextOrThrow({
      processId,
      userId: actor.id,
      perms,
    })
  assertProcessAction(perms, rel, 'startLegal')

  // NAO confia no campo status (cache derivado, pode estar stale por corrida de
  // reconcile concorrente): recomputa o invariante autoritativo AGORA. Fecha o
  // caminho de dano "processo incompleto vira juridico" independente da causa da
  // staleness — a transicao PRONTA->EM_PROCESSO so vale com a verdade conferida.
  const checklist = await getProcessChecklist(processId, actor.id, perms)
  if (
    checklist.summary.requiredPending > 0 ||
    currentProcess.housingComplexId === null
  ) {
    throw new ProcessServiceError(
      409,
      'A documentacao ainda nao esta completa: ha documentos obrigatorios pendentes ou o conjunto nao esta vinculado.',
    )
  }

  return updateProcessStatus({
    processId,
    actor,
    nextStatus: 'EM_PROCESSO',
    eventType: 'STATUS_CHANGED',
    notes: 'Processo juridico iniciado.',
    extraValues: {
      assignedAttorneyId: actor.id,
      legalProcessNumber: payload.legalProcessNumber,
      causeValue: payload.causeValue,
      protocolDate: payload.protocolDate,
      startedAt: new Date(),
    },
  })
}

export async function updateLegalProcess(
  processId: string,
  actor: ProcessActor,
  payload: {
    legalProcessNumber: string
    causeValue: string
    protocolDate: string
  },
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship: rel } =
    await getProcessContextOrThrow({
      processId,
      userId: actor.id,
      perms,
    })
  assertProcessAction(perms, rel, 'editLegal')

  if (currentProcess.status !== 'EM_PROCESSO') {
    throw new ProcessServiceError(
      409,
      'Dados do processo juridico so podem ser alterados quando o processo esta em andamento.',
    )
  }

  const legalFieldDiff: ProcessHistoryChangedFields = {}
  for (const fieldKey of [
    'legalProcessNumber',
    'causeValue',
    'protocolDate',
  ] as const) {
    const before = currentProcess[fieldKey]
    const after = payload[fieldKey]
    if (before !== after) {
      legalFieldDiff[fieldKey] = { before, after }
    }
  }

  return await db.transaction(async (tx) => {
    const [updatedProcess] = await tx
      .update(process)
      .set({
        legalProcessNumber: payload.legalProcessNumber,
        causeValue: payload.causeValue,
        protocolDate: payload.protocolDate,
      })
      .where(eq(process.id, processId))
      .returning()

    await createProcessHistoryEntry({
      processId,
      actorUserId: actor.id,
      eventType: 'UPDATED',
      changedFields:
        Object.keys(legalFieldDiff).length > 0 ? legalFieldDiff : null,
      notes: 'Dados do processo juridico atualizados.',
      executor: tx,
    })

    return updatedProcess
  })
}

export async function finalizeProcess(
  processId: string,
  actor: ProcessActor,
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship: rel } =
    await getProcessContextOrThrow({
      processId,
      userId: actor.id,
      perms,
    })
  assertProcessAction(perms, rel, 'finalize')

  if (
    !currentProcess.legalProcessNumber ||
    !currentProcess.causeValue ||
    !currentProcess.protocolDate
  ) {
    throw new ProcessServiceError(
      409,
      'Os dados do processo juridico (numero, valor da causa e data protocolo) devem estar preenchidos para finalizar.',
    )
  }

  return updateProcessStatus({
    processId,
    actor,
    nextStatus: 'FINALIZADO',
    eventType: 'STATUS_CHANGED',
    notes: 'Processo finalizado.',
    extraValues: {
      finalizedAt: new Date(),
    },
  })
}

export async function cancelProcess(
  processId: string,
  actor: ProcessActor,
  payload: CancelProcessPayload,
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship: rel } =
    await getProcessContextOrThrow({
      processId,
      userId: actor.id,
      perms,
    })
  assertProcessAction(perms, rel, 'cancel')

  assertValidStatusTransition(currentProcess.status, 'CANCELADO')

  const cancellationReason = payload.reason?.trim() || null

  return await db.transaction(async (tx) => {
    const [cancelledProcess] = await tx
      .update(process)
      .set({
        status: 'CANCELADO',
        cancelledAt: new Date(),
        cancellationReason,
      })
      .where(eq(process.id, processId))
      .returning()

    await createProcessHistoryEntry({
      processId,
      actorUserId: actor.id,
      eventType: 'CANCELLED',
      fromStatus: currentProcess.status,
      toStatus: 'CANCELADO',
      notes: cancellationReason ?? 'Processo cancelado.',
      executor: tx,
    })

    return cancelledProcess
  })
}

export async function setDocumentationAssignee(
  processId: string,
  assigneeUserId: string,
  actorUserId: string,
) {
  const currentProcess = await getProcessOrThrow(processId)

  if (isTerminalProcessStatus(currentProcess.status)) {
    throw new ProcessServiceError(
      409,
      'Nao e possivel designar responsavel em um processo finalizado ou cancelado.',
    )
  }

  const [assignee] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, assigneeUserId))
    .limit(1)

  if (!assignee) {
    throw new ProcessServiceError(404, 'Usuario responsavel nao encontrado.')
  }

  return await db.transaction(async (tx) => {
    const [updatedProcess] = await tx
      .update(process)
      .set({ documentationAssigneeId: assigneeUserId })
      .where(eq(process.id, processId))
      .returning()

    await createProcessHistoryEntry({
      processId,
      actorUserId,
      eventType: 'DOCUMENTATION_ASSIGNEE_SET',
      notes: 'Responsavel pela documentacao designado.',
      executor: tx,
    })

    return updatedProcess
  })
}

export async function removeDocumentationAssignee(
  processId: string,
  actorUserId: string,
) {
  const currentProcess = await getProcessOrThrow(processId)

  if (isTerminalProcessStatus(currentProcess.status)) {
    throw new ProcessServiceError(
      409,
      'Nao e possivel alterar responsavel em um processo finalizado ou cancelado.',
    )
  }

  if (!currentProcess.documentationAssigneeId) {
    return currentProcess
  }

  return await db.transaction(async (tx) => {
    const [updatedProcess] = await tx
      .update(process)
      .set({ documentationAssigneeId: null })
      .where(eq(process.id, processId))
      .returning()

    await createProcessHistoryEntry({
      processId,
      actorUserId,
      eventType: 'DOCUMENTATION_ASSIGNEE_REMOVED',
      notes: 'Responsavel pela documentacao removido.',
      executor: tx,
    })

    return updatedProcess
  })
}
