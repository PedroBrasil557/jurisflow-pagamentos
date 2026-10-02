import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import { loadEngineRules } from './finance.config.service'
import {
  FINANCE_ALGORITHM_VERSION,
  type FinanceCalcStep,
  type FinanceCreditStatus,
  validatePayout,
} from './finance.engine'
import {
  calculateInProcessContext,
  type ReceiptCalculationContext,
} from './finance.receipts.service'
import {
  financeAdjustment,
  financeClosing,
  financeClosingItem,
  financeClosingLine,
  financeCredit,
  financePayout,
  financeReceipt,
  financeRecipient,
  financeReserveMovement,
} from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  FinanceServiceError,
  hashPayload,
  isUniqueViolation,
  mapDbError,
  toSaoPauloDate,
  todaySaoPaulo,
  writeAudit,
} from './finance.support'

type ClosingRow = typeof financeClosing.$inferSelect

// ---------------------------------------------------------------------------
// Fechamento (P06)

export type ClosingInput = {
  receiptIds: string[]
  periodStart: string
  periodEnd: string
  notes?: string
}

/** Prévia do fechamento: revalida cada item APTO sem gravar nada. */
export async function previewClosing(
  access: FinanceAccess,
  input: ClosingInput,
) {
  assertFinance(access, 'fechar', { global: true })
  const receipts = await db
    .select()
    .from(financeReceipt)
    .where(inArray(financeReceipt.id, uniqueIds(input.receiptIds)))
  const contexts = await calculateInProcessContext(
    db,
    receipts.map((r) => r.id),
  )
  const items = receipts.map((receipt) => {
    const context = contexts.get(receipt.id)
    return {
      receiptId: receipt.id,
      status: receipt.status,
      amountCents: receipt.amountCents,
      releaseDate: receipt.releaseDate,
      issues: closingIssues(receipt, context, input),
      totals: context?.calculation.totals ?? null,
    }
  })
  return {
    items,
    canClose:
      items.length > 0 && items.every((item) => item.issues.length === 0),
    grossCents: items.reduce((sum, item) => sum + item.amountCents, 0),
  }
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)].sort()
}

function closingIssues(
  receipt: typeof financeReceipt.$inferSelect,
  context: ReceiptCalculationContext | undefined,
  input: Pick<ClosingInput, 'periodStart' | 'periodEnd'>,
): string[] {
  const issues: string[] = []
  if (receipt.status !== 'APTO') {
    issues.push(
      `Recebimento em ${receipt.status}: somente itens APTO podem fechar.`,
    )
  }
  if (
    receipt.releaseDate &&
    (receipt.releaseDate < input.periodStart ||
      receipt.releaseDate > input.periodEnd)
  ) {
    issues.push('Data de liberação fora do período do fechamento.')
  }
  if (!context || context.calculation.blocked) {
    issues.push('Memória de cálculo bloqueada (INV-01).')
  } else if (context.hash !== receipt.approvedCalculationHash) {
    issues.push(
      'A memória mudou desde a aprovação (regra/versão ou contexto do processo); recalcule e aprove novamente.',
    )
  }
  return issues
}

/**
 * Fechamento ATOMICO e IDEMPOTENTE: revalida, congela memoria e versoes, gera
 * creditos e constitui reservas/provisoes, tudo numa transacao. Indice unico
 * parcial impede o mesmo recebimento em dois fechamentos ativos.
 */
export async function createClosing(
  access: FinanceAccess,
  input: ClosingInput & { idempotencyKey: string },
): Promise<{ closing: ClosingRow; replayed: boolean }> {
  assertFinance(access, 'fechar', { global: true })
  const receiptIds = uniqueIds(input.receiptIds)
  if (receiptIds.length === 0) {
    throw new FinanceServiceError(
      422,
      'Selecione ao menos um recebimento APTO.',
    )
  }
  if (input.periodEnd < input.periodStart) {
    throw new FinanceServiceError(422, 'Período inválido.')
  }
  const requestHash = hashPayload({
    receiptIds,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    notes: input.notes?.trim() ?? '',
  })
  const replay = async () => {
    const [existing] = await db
      .select()
      .from(financeClosing)
      .where(eq(financeClosing.idempotencyKey, input.idempotencyKey))
    if (!existing) return null
    if (existing.requestHash !== requestHash) {
      throw new FinanceServiceError(
        409,
        'Chave de idempotência já usada com outro fechamento.',
      )
    }
    return { closing: existing, replayed: true }
  }
  const previous = await replay()
  if (previous) return previous

  try {
    const closing = await db.transaction(async (tx) => {
      // Double submit: requisicoes com a MESMA chave serializam aqui; a segunda
      // enxerga o fechamento ja confirmado e devolve a mesma resposta.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`finance_closing:${input.idempotencyKey}`}))`,
      )
      const [already] = await tx
        .select()
        .from(financeClosing)
        .where(eq(financeClosing.idempotencyKey, input.idempotencyKey))
      if (already) return { kind: 'replay' as const, row: already }
      // Trava os recebimentos em ordem estavel (evita deadlock entre lotes).
      const receipts = await tx
        .select({
          receipt: financeReceipt,
          processCode: process.code,
          clientName: process.fullName,
          housingComplexId: process.housingComplexId,
          housingComplexName: housingComplex.name,
        })
        .from(financeReceipt)
        .innerJoin(process, eq(financeReceipt.processId, process.id))
        .leftJoin(
          housingComplex,
          eq(process.housingComplexId, housingComplex.id),
        )
        .where(inArray(financeReceipt.id, receiptIds))
        .orderBy(asc(financeReceipt.id))
        .for('update', { of: financeReceipt })
      if (receipts.length !== receiptIds.length) {
        throw new FinanceServiceError(404, 'Recebimento não encontrado.')
      }
      const rules = await loadEngineRules(tx)
      const contexts = await calculateInProcessContext(tx, receiptIds, rules)
      const problems = receipts.flatMap(({ receipt }) =>
        closingIssues(receipt, contexts.get(receipt.id), input).map(
          (issue) => `${receipt.id.slice(0, 8)}: ${issue}`,
        ),
      )
      if (problems.length > 0) {
        throw new FinanceServiceError(409, problems.join(' '))
      }

      const totals = {
        A: 0,
        B: 0,
        D: 0,
        L: 0,
        N: 0,
        creditsCents: 0,
        provisionsCents: 0,
        reservesCents: 0,
      }
      const rulesSnapshot = new Map<string, unknown>()
      for (const { receipt } of receipts) {
        const calc = contexts.get(receipt.id)?.calculation
        const t = calc?.totals
        if (!calc || !t) continue
        totals.A += t.A
        totals.B += t.B
        totals.D += t.D
        totals.L += t.L
        totals.N += t.N
        totals.creditsCents += t.creditsCents
        totals.provisionsCents += t.provisionsCents
        totals.reservesCents += t.reservesCents
        for (const rule of calc.rulesUsed) rulesSnapshot.set(rule.id, rule)
      }

      const closingId = crypto.randomUUID()
      const [created] = await tx
        .insert(financeClosing)
        .values({
          id: closingId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          algorithmVersion: FINANCE_ALGORITHM_VERSION,
          inputHash: hashPayload(
            receipts.map(({ receipt }) => contexts.get(receipt.id)?.hash),
          ),
          rulesSnapshot: [...rulesSnapshot.values()],
          totals,
          receiptCount: receipts.length,
          grossCents: totals.A,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          notes: input.notes?.trim() ?? '',
          createdByUserId: access.actor.id,
        })
        .returning()
      const closingDate = toSaoPauloDate(created?.createdAt ?? new Date())

      for (const row of receipts) {
        const { receipt } = row
        const context = contexts.get(receipt.id) as ReceiptCalculationContext
        const itemId = crypto.randomUUID()
        await tx.insert(financeClosingItem).values({
          id: itemId,
          closingId,
          receiptId: receipt.id,
          receiptSnapshot: {
            ...receipt,
            processCode: row.processCode,
            clientName: row.clientName,
            housingComplexId: row.housingComplexId,
            housingComplexName: row.housingComplexName,
          },
          calculation: context.calculation,
          calculationHash: context.hash,
        })
        for (const step of context.calculation.steps) {
          const lineId = crypto.randomUUID()
          await tx.insert(financeClosingLine).values(
            lineValues(step, {
              id: lineId,
              closingId,
              closingItemId: itemId,
              receiptId: receipt.id,
              processId: receipt.processId,
              housingComplexId: row.housingComplexId,
              releaseDate: receipt.releaseDate as string,
            }),
          )
          if (!step.isAllocation || step.amountCents <= 0) continue
          if (step.nature === 'CREDITO' && step.recipientId) {
            await tx.insert(financeCredit).values({
              id: crypto.randomUUID(),
              closingId,
              closingLineId: lineId,
              receiptId: receipt.id,
              processId: receipt.processId,
              housingComplexId: row.housingComplexId,
              recipientId: step.recipientId,
              amountCents: step.amountCents,
            })
          } else if (step.nature === 'PROVISAO' || step.nature === 'RESERVA') {
            await tx.insert(financeReserveMovement).values({
              id: crypto.randomUUID(),
              poolKey: step.poolKey as string,
              poolLabel: step.poolLabel as string,
              nature: step.nature,
              kind: 'CONSTITUICAO',
              uniquePerProcess: step.uniqueness === 'UNICA_POR_PROCESSO',
              amountCents: step.amountCents,
              processId: receipt.processId,
              closingId,
              receiptId: receipt.id,
              closingLineId: lineId,
              movementDate: closingDate,
              description: `Constituída no fechamento (${step.code})`,
              idempotencyKey: `closing:${closingId}:line:${lineId}`,
              requestHash: lineId,
              createdByUserId: access.actor.id,
            })
          }
        }
        await tx
          .update(financeReceipt)
          .set({ status: 'FECHADO', version: receipt.version + 1 })
          .where(eq(financeReceipt.id, receipt.id))
      }
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'closing',
        entityId: closingId,
        action: 'FECHADO',
        after: {
          code: created?.code,
          receiptIds,
          totals,
          rules: [...rulesSnapshot.keys()],
        },
      })
      return { kind: 'created' as const, row: created as ClosingRow }
    })
    if (closing.kind === 'replay') {
      if (closing.row.requestHash !== requestHash) {
        throw new FinanceServiceError(
          409,
          'Chave de idempotência já usada com outro fechamento.',
        )
      }
      return { closing: closing.row, replayed: true }
    }
    return { closing: closing.row, replayed: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replay()
      if (raced) return raced
      throw new FinanceServiceError(
        409,
        'Recebimento já integra outro fechamento ativo (ou reserva única já constituída).',
      )
    }
    mapDbError(error)
  }
}

function lineValues(
  step: FinanceCalcStep,
  base: {
    id: string
    closingId: string
    closingItemId: string
    receiptId: string
    processId: string
    housingComplexId: string | null
    releaseDate: string
  },
) {
  return {
    ...base,
    stepOrder: step.order,
    code: step.code,
    kind: step.kind,
    description: step.description,
    baseKey: step.baseKey,
    baseCents: step.baseCents,
    ruleId: step.ruleId,
    ruleLineageId: step.ruleLineageId,
    ruleVersion: step.ruleVersion,
    valueType: step.valueType,
    basisPoints: step.basisPoints,
    fixedCents: step.fixedCents,
    formula: step.formula,
    exactCents: step.exactCents,
    rounding: step.rounding,
    amountCents: step.amountCents,
    nature: step.nature,
    recipientId: step.recipientId,
    poolKey: step.poolKey,
    poolLabel: step.poolLabel,
    workType: step.workType,
    isAllocation: step.isAllocation,
    note: step.note,
  }
}

/** Estorno do fechamento: preserva historico; exige nenhuma baixa ativa. */
export async function reverseClosing(
  access: FinanceAccess,
  closingId: string,
  reason: string,
) {
  assertFinance(access, 'estornar', { global: true })
  try {
    return await db.transaction(async (tx) => {
      const [closing] = await tx
        .select()
        .from(financeClosing)
        .where(eq(financeClosing.id, closingId))
        .for('update')
      if (!closing)
        throw new FinanceServiceError(404, 'Fechamento não encontrado.')
      if (closing.status !== 'ATIVO') {
        throw new FinanceServiceError(409, 'Fechamento já estornado.')
      }
      const credits = await tx
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.closingId, closingId))
        .for('update')
      if (credits.some((credit) => credit.paidCents > 0)) {
        throw new FinanceServiceError(
          409,
          'Há baixas ativas neste fechamento; estorne as baixas antes.',
        )
      }
      const now = new Date()
      for (const credit of credits) {
        await tx
          .update(financeCredit)
          .set({ status: 'ESTORNADO', updatedAt: now })
          .where(eq(financeCredit.id, credit.id))
      }
      await tx
        .update(financeReserveMovement)
        .set({
          status: 'ESTORNADO',
          reversedAt: now,
          reversedByUserId: access.actor.id,
          reversalReason: reason.trim(),
        })
        .where(
          and(
            eq(financeReserveMovement.closingId, closingId),
            eq(financeReserveMovement.kind, 'CONSTITUICAO'),
            eq(financeReserveMovement.status, 'ATIVO'),
          ),
        )
      const items = await tx
        .update(financeClosingItem)
        .set({ isActive: false })
        .where(
          and(
            eq(financeClosingItem.closingId, closingId),
            eq(financeClosingItem.isActive, true),
          ),
        )
        .returning({ receiptId: financeClosingItem.receiptId })
      // Recebimentos voltam para prévia: precisam ser recalculados e aprovados.
      for (const item of items) {
        const [receipt] = await tx
          .select({ version: financeReceipt.version })
          .from(financeReceipt)
          .where(eq(financeReceipt.id, item.receiptId))
        await tx
          .update(financeReceipt)
          .set({
            status: 'EM_PREVIA',
            approvedCalculationHash: null,
            approvedAt: null,
            approvedByUserId: null,
            version: (receipt?.version ?? 0) + 1,
          })
          .where(eq(financeReceipt.id, item.receiptId))
      }
      const [after] = await tx
        .update(financeClosing)
        .set({
          status: 'ESTORNADO',
          reversedAt: now,
          reversedByUserId: access.actor.id,
          reversalReason: reason.trim(),
        })
        .where(eq(financeClosing.id, closingId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'closing',
        entityId: closingId,
        action: 'ESTORNADO',
        reason,
        before: { status: 'ATIVO' },
        after: {
          status: 'ESTORNADO',
          credits: credits.length,
          receipts: items.length,
        },
      })
      return after
    })
  } catch (error) {
    mapDbError(error, 'O estorno afetaria saldo de reserva já consumido.')
  }
}

export async function listClosings(access: FinanceAccess) {
  assertFinance(access, 'view')
  return db
    .select({
      id: financeClosing.id,
      code: financeClosing.code,
      status: financeClosing.status,
      periodStart: financeClosing.periodStart,
      periodEnd: financeClosing.periodEnd,
      receiptCount: financeClosing.receiptCount,
      grossCents: financeClosing.grossCents,
      createdAt: financeClosing.createdAt,
      reversedAt: financeClosing.reversedAt,
    })
    .from(financeClosing)
    .orderBy(desc(financeClosing.createdAt))
    .limit(200)
}

/** Detalhe: itens, memoria congelada e creditos — filtrado pela visibilidade. */
export async function getClosingDetail(
  access: FinanceAccess,
  closingId: string,
) {
  assertFinance(access, 'view')
  const [closing] = await db
    .select()
    .from(financeClosing)
    .where(eq(financeClosing.id, closingId))
  if (!closing) throw new FinanceServiceError(404, 'Fechamento não encontrado.')
  const visible = (extra: SQL) =>
    access.processFilter ? and(extra, access.processFilter) : extra
  const items = await db
    .select({
      id: financeClosingItem.id,
      receiptId: financeClosingItem.receiptId,
      isActive: financeClosingItem.isActive,
      receiptSnapshot: financeClosingItem.receiptSnapshot,
      calculation: financeClosingItem.calculation,
    })
    .from(financeClosingItem)
    .innerJoin(
      financeReceipt,
      eq(financeClosingItem.receiptId, financeReceipt.id),
    )
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(visible(eq(financeClosingItem.closingId, closingId)))
  const credits = await listCredits(access, { closingId })
  if (!access.isGlobal && items.length === 0) {
    throw new FinanceServiceError(404, 'Fechamento não encontrado.')
  }
  return {
    closing: access.isGlobal
      ? closing
      : { ...closing, totals: null, rulesSnapshot: null },
    items,
    credits,
  }
}

// ---------------------------------------------------------------------------
// Creditos, baixas (P07) e ajustes

export type CreditQuery = {
  closingId?: string
  recipientId?: string
  status?: FinanceCreditStatus[]
  processId?: string
}

export async function listCredits(access: FinanceAccess, query: CreditQuery) {
  assertFinance(access, 'view')
  const filters: SQL[] = []
  if (access.processFilter) filters.push(access.processFilter)
  if (query.closingId)
    filters.push(eq(financeCredit.closingId, query.closingId))
  if (query.recipientId) {
    filters.push(eq(financeCredit.recipientId, query.recipientId))
  }
  if (query.processId)
    filters.push(eq(financeCredit.processId, query.processId))
  if (query.status?.length)
    filters.push(inArray(financeCredit.status, query.status))
  return db
    .select({
      id: financeCredit.id,
      closingId: financeCredit.closingId,
      closingCode: financeClosing.code,
      closingLineId: financeCredit.closingLineId,
      stepCode: financeClosingLine.code,
      workType: financeClosingLine.workType,
      ruleId: financeClosingLine.ruleId,
      ruleVersion: financeClosingLine.ruleVersion,
      receiptId: financeCredit.receiptId,
      processId: financeCredit.processId,
      processCode: process.code,
      clientName: process.fullName,
      housingComplexName: housingComplex.name,
      recipientId: financeCredit.recipientId,
      recipientName: financeRecipient.name,
      amountCents: financeCredit.amountCents,
      adjustedCents: financeCredit.adjustedCents,
      paidCents: financeCredit.paidCents,
      status: financeCredit.status,
      createdAt: financeCredit.createdAt,
    })
    .from(financeCredit)
    .innerJoin(financeClosing, eq(financeCredit.closingId, financeClosing.id))
    .innerJoin(
      financeClosingLine,
      eq(financeCredit.closingLineId, financeClosingLine.id),
    )
    .innerJoin(
      financeRecipient,
      eq(financeCredit.recipientId, financeRecipient.id),
    )
    .innerJoin(process, eq(financeCredit.processId, process.id))
    .leftJoin(
      housingComplex,
      eq(financeCredit.housingComplexId, housingComplex.id),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      asc(financeRecipient.name),
      asc(financeCredit.createdAt),
      asc(financeCredit.id),
    )
}

export type PayoutInput = {
  creditId: string
  amountCents: number
  paidOn: string
  reference: string
  notes?: string
}

/** Baixa idempotente; o trigger serializa e barra acumulado > devido (INV-06). */
export async function createPayout(
  access: FinanceAccess,
  input: PayoutInput & { idempotencyKey: string },
) {
  assertFinance(access, 'baixar', { global: true })
  if (input.paidOn > todaySaoPaulo()) {
    throw new FinanceServiceError(
      422,
      'A data efetiva da baixa não pode ser futura: registre apenas pagamentos já realizados.',
    )
  }
  const requestHash = hashPayload({
    creditId: input.creditId,
    amountCents: input.amountCents,
    paidOn: input.paidOn,
    reference: input.reference.trim(),
    notes: input.notes?.trim() ?? '',
  })
  const replay = async () => {
    const [existing] = await db
      .select()
      .from(financePayout)
      .where(eq(financePayout.idempotencyKey, input.idempotencyKey))
    if (!existing) return null
    if (existing.requestHash !== requestHash) {
      throw new FinanceServiceError(
        409,
        'Chave de idempotência já usada com outra baixa.',
      )
    }
    return { payout: existing, replayed: true }
  }
  const previous = await replay()
  if (previous) return previous
  try {
    const payout = await db.transaction(async (tx) => {
      const [credit] = await tx
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.id, input.creditId))
        .for('update')
      if (!credit) throw new FinanceServiceError(404, 'Crédito não encontrado.')
      if (credit.status === 'ESTORNADO') {
        throw new FinanceServiceError(
          409,
          'Crédito estornado não aceita baixa.',
        )
      }
      const [closing] = await tx
        .select({ createdAt: financeClosing.createdAt })
        .from(financeClosing)
        .where(eq(financeClosing.id, credit.closingId))
      if (!closing) {
        throw new FinanceServiceError(
          409,
          'Finalização do crédito não encontrada.',
        )
      }
      const closingDate = toSaoPauloDate(closing.createdAt)
      if (input.paidOn < closingDate) {
        throw new FinanceServiceError(
          422,
          `A data do pagamento não pode ser anterior à finalização (${closingDate}).`,
        )
      }
      const problem = validatePayout(
        credit.amountCents + credit.adjustedCents,
        credit.paidCents,
        input.amountCents,
      )
      if (problem) throw new FinanceServiceError(422, problem)
      const [created] = await tx
        .insert(financePayout)
        .values({
          id: crypto.randomUUID(),
          creditId: credit.id,
          recipientId: credit.recipientId,
          amountCents: input.amountCents,
          paidOn: input.paidOn,
          reference: input.reference.trim(),
          notes: input.notes?.trim() ?? '',
          balanceAfterCents: 0, // definido pelo trigger
          idempotencyKey: input.idempotencyKey,
          requestHash,
          createdByUserId: access.actor.id,
        })
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'payout',
        entityId: created?.id as string,
        action: 'BAIXA_REGISTRADA',
        after: created,
      })
      return created
    })
    return { payout, replayed: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replay()
      if (raced) return raced
    }
    mapDbError(error)
  }
}

export async function reversePayout(
  access: FinanceAccess,
  payoutId: string,
  reason: string,
) {
  assertFinance(access, 'estornar', { global: true })
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(financePayout)
        .where(eq(financePayout.id, payoutId))
        .for('update')
      if (!before) throw new FinanceServiceError(404, 'Baixa não encontrada.')
      if (before.status !== 'ATIVO') {
        throw new FinanceServiceError(409, 'Baixa já estornada.')
      }
      const [after] = await tx
        .update(financePayout)
        .set({
          status: 'ESTORNADO',
          reversedAt: new Date(),
          reversedByUserId: access.actor.id,
          reversalReason: reason.trim(),
        })
        .where(eq(financePayout.id, payoutId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'payout',
        entityId: payoutId,
        action: 'BAIXA_ESTORNADA',
        reason,
        before,
        after,
      })
      return after
    })
  } catch (error) {
    mapDbError(error)
  }
}

export async function listPayouts(
  access: FinanceAccess,
  query: { creditId?: string; recipientId?: string },
) {
  assertFinance(access, 'view')
  const filters: SQL[] = []
  if (access.processFilter) filters.push(access.processFilter)
  if (query.creditId) filters.push(eq(financePayout.creditId, query.creditId))
  if (query.recipientId) {
    filters.push(eq(financePayout.recipientId, query.recipientId))
  }
  return db
    .select({
      payout: financePayout,
      recipientName: financeRecipient.name,
    })
    .from(financePayout)
    .innerJoin(financeCredit, eq(financePayout.creditId, financeCredit.id))
    .innerJoin(process, eq(financeCredit.processId, process.id))
    .innerJoin(
      financeRecipient,
      eq(financePayout.recipientId, financeRecipient.id),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(financePayout.paidOn), desc(financePayout.createdAt))
}

export async function createAdjustment(
  access: FinanceAccess,
  input: {
    creditId: string
    amountCents: number
    reason: string
    idempotencyKey: string
  },
) {
  assertFinance(access, 'estornar', { global: true })
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents === 0) {
    throw new FinanceServiceError(422, 'O ajuste deve ser diferente de zero.')
  }
  const requestHash = hashPayload({
    creditId: input.creditId,
    amountCents: input.amountCents,
    reason: input.reason.trim(),
  })
  const replay = async () => {
    const [existing] = await db
      .select()
      .from(financeAdjustment)
      .where(eq(financeAdjustment.idempotencyKey, input.idempotencyKey))
    if (!existing) return null
    if (existing.requestHash !== requestHash) {
      throw new FinanceServiceError(
        409,
        'Chave de idempotência já usada com outro ajuste.',
      )
    }
    return { adjustment: existing, replayed: true }
  }
  const previous = await replay()
  if (previous) return previous
  try {
    const adjustment = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(financeAdjustment)
        .values({
          id: crypto.randomUUID(),
          creditId: input.creditId,
          amountCents: input.amountCents,
          reason: input.reason.trim(),
          idempotencyKey: input.idempotencyKey,
          requestHash,
          createdByUserId: access.actor.id,
        })
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'credit',
        entityId: input.creditId,
        action: 'AJUSTE',
        reason: input.reason,
        after: created,
      })
      return created
    })
    return { adjustment, replayed: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replay()
      if (raced) return raced
    }
    mapDbError(error)
  }
}
