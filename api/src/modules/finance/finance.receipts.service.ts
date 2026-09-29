import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { db } from '../../shared/db'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import { loadEngineRules } from './finance.config.service'
import {
  calculateBatch,
  type FinanceEngineRule,
  type FinanceReceiptCalculation,
  type FinanceReceiptInput,
  uniqueReserveKey,
} from './finance.engine'
import {
  type FinanceReceiptKind,
  type FinanceReceiptStatus,
  financeAttachment,
  financeAuditLog,
  financeClosing,
  financeClosingItem,
  financeCredit,
  financeReceipt,
  financeRecipient,
  financeReserveMovement,
} from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  type FinanceDb,
  FinanceServiceError,
  hashPayload,
  isUniqueViolation,
  mapDbError,
  toSaoPauloDate,
  writeAudit,
} from './finance.support'

export type ReceiptInput = {
  processId: string
  kind: FinanceReceiptKind
  amountCents: number
  releaseDate?: string | null
  reference?: string
  originDescription?: string
  description?: string
}

type ReceiptRow = typeof financeReceipt.$inferSelect

const OPEN_STATUSES: FinanceReceiptStatus[] = [
  'RASCUNHO',
  'EM_PREVIA',
  'BLOQUEADO',
  'APTO',
]

/** Processo visivel ao usuario (404 quando fora do escopo — nao vaza existencia). */
export async function getVisibleProcess(
  access: FinanceAccess,
  processId: string,
  tx: FinanceDb = db,
) {
  const [row] = await tx
    .select({
      id: process.id,
      code: process.code,
      status: process.status,
      clientName: process.fullName,
      housingComplexId: process.housingComplexId,
      housingComplexName: housingComplex.name,
      createdAt: process.createdAt,
    })
    .from(process)
    .leftJoin(housingComplex, eq(process.housingComplexId, housingComplex.id))
    .where(
      access.processFilter
        ? and(eq(process.id, processId), access.processFilter)
        : eq(process.id, processId),
    )
    .limit(1)
  if (!row) throw new FinanceServiceError(404, 'Processo não encontrado.')
  return row
}

async function getVisibleReceiptRow(
  access: FinanceAccess,
  receiptId: string,
  tx: FinanceDb = db,
  lock = false,
): Promise<ReceiptRow> {
  const base = tx
    .select({ receipt: financeReceipt })
    .from(financeReceipt)
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(
      access.processFilter
        ? and(eq(financeReceipt.id, receiptId), access.processFilter)
        : eq(financeReceipt.id, receiptId),
    )
  const [row] = lock
    ? await base.for('update', { of: financeReceipt })
    : await base
  if (!row) throw new FinanceServiceError(404, 'Recebimento não encontrado.')
  return row.receipt
}

function receiptRequestHash(input: ReceiptInput) {
  return hashPayload({
    processId: input.processId,
    kind: input.kind,
    amountCents: input.amountCents,
    releaseDate: input.releaseDate ?? null,
    reference: input.reference?.trim() ?? '',
    originDescription: input.originDescription?.trim() ?? '',
    description: input.description?.trim() ?? '',
  })
}

/** Criacao idempotente: mesma chave + mesmo payload = mesmo recebimento. */
export async function createReceipt(
  access: FinanceAccess,
  input: ReceiptInput & { idempotencyKey: string },
): Promise<{ receipt: ReceiptRow; replayed: boolean }> {
  assertFinance(access, 'lancar')
  const requestHash = receiptRequestHash(input)
  const existing = await findByIdempotency(input.idempotencyKey)
  if (existing) return replayOrConflict(existing, requestHash)

  const proc = await getVisibleProcess(access, input.processId)
  const id = crypto.randomUUID()
  try {
    const receipt = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(financeReceipt)
        .values({
          id,
          processId: proc.id,
          kind: input.kind,
          amountCents: input.amountCents,
          releaseDate: input.releaseDate ?? null,
          reference: input.reference?.trim() ?? '',
          originDescription: input.originDescription?.trim() ?? '',
          description: input.description?.trim() ?? '',
          // data de cadastro do cliente preservada (INV-02)
          clientRegistrationDate: toSaoPauloDate(proc.createdAt),
          idempotencyKey: input.idempotencyKey,
          requestHash,
          createdByUserId: access.actor.id,
        })
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'receipt',
        entityId: id,
        action: 'CRIADO',
        after: created,
      })
      return created as ReceiptRow
    })
    return { receipt, replayed: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await findByIdempotency(input.idempotencyKey)
      if (raced) return replayOrConflict(raced, requestHash)
    }
    mapDbError(error)
  }
}

async function findByIdempotency(key: string) {
  const [row] = await db
    .select()
    .from(financeReceipt)
    .where(eq(financeReceipt.idempotencyKey, key))
  return row
}

function replayOrConflict(existing: ReceiptRow, requestHash: string) {
  if (existing.requestHash !== requestHash) {
    throw new FinanceServiceError(
      409,
      'Chave de idempotência já usada com dados diferentes.',
    )
  }
  return { receipt: existing, replayed: true }
}

/** Edita dados do recebimento; volta a RASCUNHO e descarta prévia/aprovação. */
export async function updateReceipt(
  access: FinanceAccess,
  receiptId: string,
  input: Partial<ReceiptInput> & { version: number },
) {
  assertFinance(access, 'lancar')
  try {
    return await db.transaction(async (tx) => {
      const before = await getVisibleReceiptRow(access, receiptId, tx, true)
      if (!OPEN_STATUSES.includes(before.status)) {
        throw new FinanceServiceError(
          409,
          'Recebimento fechado ou cancelado não pode ser editado; use ajuste ou estorno.',
        )
      }
      if (before.version !== input.version) {
        throw new FinanceServiceError(
          409,
          'O recebimento foi alterado por outra pessoa; recarregue.',
        )
      }
      if (input.processId && input.processId !== before.processId) {
        throw new FinanceServiceError(
          422,
          'O processo de um recebimento não pode ser trocado; cancele e crie outro.',
        )
      }
      const [after] = await tx
        .update(financeReceipt)
        .set({
          kind: input.kind ?? before.kind,
          amountCents: input.amountCents ?? before.amountCents,
          releaseDate:
            input.releaseDate !== undefined
              ? input.releaseDate
              : before.releaseDate,
          reference: input.reference?.trim() ?? before.reference,
          originDescription:
            input.originDescription?.trim() ?? before.originDescription,
          description: input.description?.trim() ?? before.description,
          status: 'RASCUNHO',
          lastCalculation: null,
          lastCalculationHash: null,
          lastCalculatedAt: null,
          approvedCalculationHash: null,
          approvedAt: null,
          approvedByUserId: null,
          version: before.version + 1,
        })
        .where(eq(financeReceipt.id, receiptId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'receipt',
        entityId: receiptId,
        action: 'ALTERADO',
        before,
        after,
      })
      return after
    })
  } catch (error) {
    mapDbError(error)
  }
}

export type ReceiptCalculationContext = {
  calculation: FinanceReceiptCalculation
  hash: string
  warnings: string[]
}

export function toEngineInput(
  receipt: Pick<
    ReceiptRow,
    | 'id'
    | 'processId'
    | 'amountCents'
    | 'releaseDate'
    | 'clientRegistrationDate'
    | 'createdAt'
  >,
  housingComplexId: string | null,
): FinanceReceiptInput {
  return {
    receiptId: receipt.id,
    processId: receipt.processId,
    housingComplexId,
    clientRegistrationDate: receipt.clientRegistrationDate,
    grossCents: receipt.amountCents,
    releaseDate: receipt.releaseDate,
    createdAt: receipt.createdAt.toISOString(),
  }
}

export function calculationHash(calc: FinanceReceiptCalculation): string {
  return hashPayload({
    algorithmVersion: calc.algorithmVersion,
    receiptId: calc.receiptId,
    processId: calc.processId,
    housingComplexId: calc.housingComplexId,
    clientRegistrationDate: calc.clientRegistrationDate,
    blocks: calc.blocks,
    steps: calc.steps,
    rulesUsed: calc.rulesUsed,
  })
}

/** Reservas unicas ja constituidas (fechamentos ativos) para os processos. */
export async function constitutedUniqueReserves(
  tx: FinanceDb,
  processIds: string[],
): Promise<Set<string>> {
  if (processIds.length === 0) return new Set()
  const rows = await tx
    .select({
      poolKey: financeReserveMovement.poolKey,
      processId: financeReserveMovement.processId,
    })
    .from(financeReserveMovement)
    .where(
      and(
        inArray(financeReserveMovement.processId, processIds),
        eq(financeReserveMovement.kind, 'CONSTITUICAO'),
        eq(financeReserveMovement.status, 'ATIVO'),
        eq(financeReserveMovement.uniquePerProcess, true),
      ),
    )
  return new Set(
    rows.map((row) => uniqueReserveKey(row.poolKey, row.processId as string)),
  )
}

/**
 * Calcula recebimentos no contexto do processo: a reserva unica pertence ao
 * PRIMEIRO recebimento em aberto (data de liberacao, criacao, id), independente
 * da ordem em que forem fechados (P09).
 */
export async function calculateInProcessContext(
  tx: FinanceDb,
  targetIds: string[],
  rules?: FinanceEngineRule[],
): Promise<Map<string, ReceiptCalculationContext>> {
  const engineRules = rules ?? (await loadEngineRules(tx))
  const targets = await tx
    .select({ processId: financeReceipt.processId })
    .from(financeReceipt)
    .where(inArray(financeReceipt.id, targetIds))
  const processIds = [...new Set(targets.map((t) => t.processId))]
  const siblings = await tx
    .select({
      receipt: financeReceipt,
      housingComplexId: process.housingComplexId,
      processStatus: process.status,
    })
    .from(financeReceipt)
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(
      and(
        inArray(financeReceipt.processId, processIds),
        or(
          inArray(financeReceipt.status, OPEN_STATUSES),
          inArray(financeReceipt.id, targetIds),
        ),
      ),
    )
  const constituted = await constitutedUniqueReserves(tx, processIds)
  const result = new Map<string, ReceiptCalculationContext>()
  for (const processId of processIds) {
    const group = siblings.filter((s) => s.receipt.processId === processId)
    const batch = calculateBatch({
      receipts: group.map((s) => toEngineInput(s.receipt, s.housingComplexId)),
      rules: engineRules,
      constitutedUniqueReserves: constituted,
    })
    for (const calc of batch.receipts) {
      if (!targetIds.includes(calc.receiptId)) continue
      const sibling = group.find((s) => s.receipt.id === calc.receiptId)
      const warnings: string[] = []
      if (sibling?.processStatus === 'RASCUNHO') {
        warnings.push(
          'Processo em rascunho: confirme a data de cadastro do cliente usada na seleção das regras.',
        )
      }
      result.set(calc.receiptId, {
        calculation: calc,
        hash: calculationHash(calc),
        warnings,
      })
    }
  }
  return result
}

/** Prévia (P02/P03): grava a memória e define EM_PREVIA ou BLOQUEADO. */
export async function calculateReceipt(
  access: FinanceAccess,
  receiptId: string,
) {
  assertFinance(access, 'lancar')
  try {
    return await db.transaction(async (tx) => {
      const before = await getVisibleReceiptRow(access, receiptId, tx, true)
      if (!OPEN_STATUSES.includes(before.status)) {
        throw new FinanceServiceError(
          409,
          'Somente recebimentos em aberto podem ser recalculados.',
        )
      }
      const context = (await calculateInProcessContext(tx, [receiptId])).get(
        receiptId,
      ) as ReceiptCalculationContext
      const status: FinanceReceiptStatus = context.calculation.blocked
        ? 'BLOQUEADO'
        : 'EM_PREVIA'
      const [after] = await tx
        .update(financeReceipt)
        .set({
          status,
          lastCalculation: {
            ...context.calculation,
            warnings: context.warnings,
          },
          lastCalculationHash: context.hash,
          lastCalculatedAt: new Date(),
          approvedCalculationHash: null,
          approvedAt: null,
          approvedByUserId: null,
          version: before.version + 1,
        })
        .where(eq(financeReceipt.id, receiptId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'receipt',
        entityId: receiptId,
        action: status === 'BLOQUEADO' ? 'BLOQUEADO' : 'PREVIA_CALCULADA',
        after: {
          status,
          hash: context.hash,
          blocks: context.calculation.blocks,
          totals: context.calculation.totals,
          rules: context.calculation.rulesUsed.map((r) => ({
            id: r.id,
            version: r.version,
          })),
        },
      })
      return after
    })
  } catch (error) {
    mapDbError(error)
  }
}

/** Validação (V3 §6.5): recalcula e só aprova se nada mudou desde a prévia. */
export async function approveReceipt(access: FinanceAccess, receiptId: string) {
  assertFinance(access, 'conferir')
  try {
    return await db.transaction(async (tx) => {
      const before = await getVisibleReceiptRow(access, receiptId, tx, true)
      if (before.status !== 'EM_PREVIA') {
        throw new FinanceServiceError(
          409,
          'Somente prévias calculadas e sem bloqueio podem ser aprovadas.',
        )
      }
      const context = (await calculateInProcessContext(tx, [receiptId])).get(
        receiptId,
      ) as ReceiptCalculationContext
      if (
        context.calculation.blocked ||
        context.hash !== before.lastCalculationHash
      ) {
        throw new FinanceServiceError(
          409,
          'A configuração ou os dados mudaram desde a prévia; recalcule antes de aprovar.',
        )
      }
      const [after] = await tx
        .update(financeReceipt)
        .set({
          status: 'APTO',
          approvedCalculationHash: context.hash,
          approvedAt: new Date(),
          approvedByUserId: access.actor.id,
          version: before.version + 1,
        })
        .where(eq(financeReceipt.id, receiptId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'receipt',
        entityId: receiptId,
        action: 'APROVADO',
        after: { status: 'APTO', hash: context.hash },
      })
      return after
    })
  } catch (error) {
    mapDbError(error)
  }
}

export async function cancelReceipt(
  access: FinanceAccess,
  receiptId: string,
  reason: string,
) {
  assertFinance(access, 'lancar')
  try {
    return await db.transaction(async (tx) => {
      const before = await getVisibleReceiptRow(access, receiptId, tx, true)
      if (!OPEN_STATUSES.includes(before.status)) {
        throw new FinanceServiceError(
          409,
          'Recebimento fechado ou já cancelado; use estorno do fechamento.',
        )
      }
      const [after] = await tx
        .update(financeReceipt)
        .set({
          status: 'CANCELADO',
          cancelledAt: new Date(),
          cancelledByUserId: access.actor.id,
          cancelReason: reason.trim(),
          version: before.version + 1,
        })
        .where(eq(financeReceipt.id, receiptId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'receipt',
        entityId: receiptId,
        action: 'CANCELADO',
        reason,
        before: { status: before.status },
        after: { status: 'CANCELADO' },
      })
      return after
    })
  } catch (error) {
    mapDbError(error)
  }
}

export type ReceiptListQuery = {
  status?: FinanceReceiptStatus[]
  processId?: string
  search?: string
}

export async function listReceipts(
  access: FinanceAccess,
  query: ReceiptListQuery,
) {
  assertFinance(access, 'view')
  const filters: SQL[] = []
  if (access.processFilter) filters.push(access.processFilter)
  if (query.status?.length)
    filters.push(inArray(financeReceipt.status, query.status))
  if (query.processId)
    filters.push(eq(financeReceipt.processId, query.processId))
  if (query.search?.trim()) {
    const term = `%${query.search.trim()}%`
    filters.push(
      or(
        ilike(process.code, term),
        ilike(process.fullName, term),
        ilike(financeReceipt.reference, term),
      ) as SQL,
    )
  }
  return db
    .select({
      id: financeReceipt.id,
      status: financeReceipt.status,
      kind: financeReceipt.kind,
      amountCents: financeReceipt.amountCents,
      releaseDate: financeReceipt.releaseDate,
      reference: financeReceipt.reference,
      createdAt: financeReceipt.createdAt,
      processId: process.id,
      processCode: process.code,
      clientName: process.fullName,
      housingComplexName: housingComplex.name,
    })
    .from(financeReceipt)
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .leftJoin(housingComplex, eq(process.housingComplexId, housingComplex.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(financeReceipt.createdAt), asc(financeReceipt.id))
    .limit(500)
}

export async function getReceiptDetail(
  access: FinanceAccess,
  receiptId: string,
) {
  assertFinance(access, 'view')
  const receipt = await getVisibleReceiptRow(access, receiptId)
  const proc = await getVisibleProcess(access, receipt.processId)
  const [attachments, history, closings, credits, processReceipts] =
    await Promise.all([
      db
        .select({
          id: financeAttachment.id,
          originalFileName: financeAttachment.originalFileName,
          mimeType: financeAttachment.mimeType,
          sizeInBytes: financeAttachment.sizeInBytes,
          uploadedAt: financeAttachment.uploadedAt,
        })
        .from(financeAttachment)
        .where(
          and(
            eq(financeAttachment.receiptId, receiptId),
            sql`${financeAttachment.removedAt} IS NULL`,
          ),
        ),
      db
        .select({
          id: financeAuditLog.id,
          action: financeAuditLog.action,
          reason: financeAuditLog.reason,
          createdAt: financeAuditLog.createdAt,
          actorUserId: financeAuditLog.actorUserId,
        })
        .from(financeAuditLog)
        .where(
          and(
            eq(financeAuditLog.entityType, 'receipt'),
            eq(financeAuditLog.entityId, receiptId),
          ),
        )
        .orderBy(asc(financeAuditLog.createdAt)),
      db
        .select({
          closingId: financeClosing.id,
          code: financeClosing.code,
          status: financeClosing.status,
          isActive: financeClosingItem.isActive,
          createdAt: financeClosing.createdAt,
        })
        .from(financeClosingItem)
        .innerJoin(
          financeClosing,
          eq(financeClosingItem.closingId, financeClosing.id),
        )
        .where(eq(financeClosingItem.receiptId, receiptId)),
      db
        .select({
          id: financeCredit.id,
          recipientName: financeRecipient.name,
          amountCents: financeCredit.amountCents,
          adjustedCents: financeCredit.adjustedCents,
          paidCents: financeCredit.paidCents,
          status: financeCredit.status,
        })
        .from(financeCredit)
        .innerJoin(
          financeRecipient,
          eq(financeCredit.recipientId, financeRecipient.id),
        )
        .where(eq(financeCredit.receiptId, receiptId)),
      db
        .select({
          id: financeReceipt.id,
          status: financeReceipt.status,
          amountCents: financeReceipt.amountCents,
          releaseDate: financeReceipt.releaseDate,
        })
        .from(financeReceipt)
        .where(eq(financeReceipt.processId, receipt.processId))
        .orderBy(
          asc(financeReceipt.releaseDate),
          asc(financeReceipt.createdAt),
        ),
    ])
  return {
    receipt,
    process: proc,
    attachments,
    history,
    closings,
    credits,
    processReceipts,
  }
}

/** Busca de processos visiveis para o formulario de recebimento (P01). */
export async function searchProcesses(access: FinanceAccess, search: string) {
  assertFinance(access, 'lancar')
  const term = `%${search.trim()}%`
  const filters: SQL[] = []
  if (access.processFilter) filters.push(access.processFilter)
  if (search.trim()) {
    filters.push(
      or(ilike(process.code, term), ilike(process.fullName, term)) as SQL,
    )
  }
  const rows = await db
    .select({
      id: process.id,
      code: process.code,
      clientName: process.fullName,
      status: process.status,
      housingComplexId: process.housingComplexId,
      housingComplexName: housingComplex.name,
      createdAt: process.createdAt,
    })
    .from(process)
    .leftJoin(housingComplex, eq(process.housingComplexId, housingComplex.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(process.code))
    .limit(20)
  return rows.map(({ createdAt, ...row }) => ({
    ...row,
    clientRegistrationDate: toSaoPauloDate(createdAt),
  }))
}

export async function listHousingComplexOptions(access: FinanceAccess) {
  assertFinance(access, 'view')
  return db
    .select({ id: housingComplex.id, name: housingComplex.name })
    .from(housingComplex)
    .orderBy(asc(housingComplex.name))
}
