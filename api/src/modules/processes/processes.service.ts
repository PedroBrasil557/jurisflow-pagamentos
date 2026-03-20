import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import type { AppBindings } from '../../shared/types/app'
import { defaultUserRole, isUserRole, type UserRole } from '../auth/auth.roles'
import { user } from '../auth/auth.schema'
import {
  ensureProcessChecklistItems,
  getProcessChecklist,
} from './processes.checklist.service'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  type ProcessHistoryChangedFields,
  process,
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
  'deliveredMoreThanTenYears',
  'purchaseAgreementLessThanTenYears',
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

function getActorRole(actor: ProcessActor): UserRole {
  return isUserRole(actor.role) ? actor.role : defaultUserRole
}

function assertAttorneyOrAdmin(actor: ProcessActor) {
  const actorRole = getActorRole(actor)

  if (actorRole !== 'attorney' && actorRole !== 'admin') {
    throw new ProcessServiceError(
      403,
      'Apenas advogados ou administradores podem executar esta acao.',
    )
  }
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

function getLegalProcessLabel(currentProcess: ProcessRecord) {
  switch (currentProcess.status) {
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
    case 'STATUS_CHANGED':
      switch (historyEntry.toStatus) {
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
    birthDate: currentProcess.birthDate,
    nationality: currentProcess.nationality,
    maritalStatus: currentProcess.maritalStatus,
    profession: currentProcess.profession,
    ownerType: currentProcess.ownerType,
    cpf: currentProcess.cpf,
    rg: currentProcess.rg,
    cadunico: currentProcess.cadunico,
    propertyPaidOff: currentProcess.propertyPaidOff,
    deliveredMoreThanTenYears: currentProcess.deliveredMoreThanTenYears,
    purchaseAgreementLessThanTenYears:
      currentProcess.purchaseAgreementLessThanTenYears,
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
    witness1Id: currentProcess.witness1Id,
    witness2Id: currentProcess.witness2Id,
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

  const [updatedProcess] = await db
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
  })

  return updatedProcess
}

export async function listProcesses(query: ListProcessesQuery) {
  const filters = []

  if (query.status) {
    filters.push(eq(process.status, query.status))
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

  const [attorneys, historyEntries] = await Promise.all([
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
  ])

  const attorneysById = new Map(attorneys.map((item) => [item.id, item.name]))
  const latestHistoryByProcessId = new Map<string, ProcessListHistoryRecord>()

  for (const historyEntry of historyEntries) {
    if (!latestHistoryByProcessId.has(historyEntry.processId)) {
      latestHistoryByProcessId.set(historyEntry.processId, historyEntry)
    }
  }

  return {
    items: items.map((item) => {
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

export async function getProcessById(processId: string) {
  return getProcessOrThrow(processId)
}

export async function getProcessHistory(
  processId: string,
  options?: { cursor?: string; limit?: number },
) {
  await getProcessOrThrow(processId)

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
) {
  const processId = crypto.randomUUID()
  const processCode = buildProcessCode()

  const [createdProcess] = await db
    .insert(process)
    .values({
      id: processId,
      code: processCode,
      status: 'EM_DOCUMENTACAO',
      createdByUserId: actor.id,
      assignedAttorneyId: null,
      documentationReadyAt: null,
      startedAt: null,
      finalizedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      ...payload,
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

  return createdProcess
}

export async function updateProcess(
  processId: string,
  payload: UpdateProcessPayload,
  actor: ProcessActor,
) {
  const currentProcess = await getProcessOrThrow(processId)

  assertProcessCanBeEdited(currentProcess)

  const currentValues = pickEditableValues(currentProcess)
  const mergedValues = normalizeProcessPayload({
    ...currentValues,
    ...payload,
  })
  const changedFields = buildChangedFields(currentValues, mergedValues)

  if (Object.keys(changedFields).length === 0) {
    return currentProcess
  }

  const [updatedProcess] = await db
    .update(process)
    .set({
      ...mergedValues,
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

  return updatedProcess
}

export async function markProcessDocumentationReady(
  processId: string,
  actor: ProcessActor,
) {
  const checklist = await getProcessChecklist(processId)

  if (checklist.summary.requiredPending > 0) {
    throw new ProcessServiceError(
      409,
      'Ainda existem documentos obrigatorios pendentes para este processo.',
    )
  }

  return updateProcessStatus({
    processId,
    actor,
    nextStatus: 'DOCUMENTACAO_PRONTA',
    eventType: 'STATUS_CHANGED',
    notes: 'Documentacao marcada como pronta.',
    extraValues: {
      documentationReadyAt: new Date(),
    },
  })
}

export async function startProcess(
  processId: string,
  actor: ProcessActor,
  payload: {
    legalProcessNumber: string
    causeValue: string
    protocolDate: string
  },
) {
  assertAttorneyOrAdmin(actor)

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
) {
  assertAttorneyOrAdmin(actor)

  const currentProcess = await getProcessOrThrow(processId)

  if (currentProcess.status !== 'EM_PROCESSO') {
    throw new ProcessServiceError(
      409,
      'Dados do processo juridico so podem ser alterados quando o processo esta em andamento.',
    )
  }

  const [updatedProcess] = await db
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
    notes: 'Dados do processo juridico atualizados.',
  })

  return updatedProcess
}

export async function finalizeProcess(processId: string, actor: ProcessActor) {
  assertAttorneyOrAdmin(actor)

  const currentProcess = await getProcessOrThrow(processId)

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
) {
  const currentProcess = await getProcessOrThrow(processId)

  assertValidStatusTransition(currentProcess.status, 'CANCELADO')

  const cancellationReason = payload.reason?.trim() || null

  const [cancelledProcess] = await db
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
  })

  return cancelledProcess
}
