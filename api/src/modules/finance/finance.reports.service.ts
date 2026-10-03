import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { db } from '../../shared/db'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import { validateReserveDebit } from './finance.engine'
import { formatCentsBRL } from './finance.money'
import {
  financeAdjustment,
  financeClosing,
  financeClosingLine,
  financeCredit,
  financePayout,
  financeReceipt,
  financeRecipient,
  financeReserveMovement,
  financeRule,
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

// ---------------------------------------------------------------------------
// Visao geral

export async function getOverview(access: FinanceAccess) {
  assertFinance(access, 'view')
  const visible = access.processFilter
  const [receipts] = await db
    .select({
      count: sql<number>`count(*)::int`,
      grossCents: sql<number>`coalesce(sum(${financeReceipt.amountCents}) FILTER (WHERE ${financeReceipt.status} <> 'CANCELADO'), 0)::bigint`,
      draft: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} IN ('RASCUNHO', 'EM_PREVIA'))::int`,
      blocked: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} = 'BLOQUEADO')::int`,
      ready: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} = 'APTO')::int`,
      closed: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} = 'FECHADO')::int`,
    })
    .from(financeReceipt)
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(visible)
  const creditFilters: SQL[] = []
  if (visible) creditFilters.push(visible)
  const [credits] = await db
    .select({
      dueCents: sql<number>`coalesce(sum(${financeCredit.amountCents} + ${financeCredit.adjustedCents}) FILTER (WHERE ${financeCredit.status} <> 'ESTORNADO'), 0)::bigint`,
      paidCents: sql<number>`coalesce(sum(${financeCredit.paidCents}) FILTER (WHERE ${financeCredit.status} <> 'ESTORNADO'), 0)::bigint`,
    })
    .from(financeCredit)
    .innerJoin(process, eq(financeCredit.processId, process.id))
    .innerJoin(
      financeRecipient,
      eq(financeCredit.recipientId, financeRecipient.id),
    )
    .where(
      and(
        ...(access.isGlobal
          ? creditFilters
          : [
              ...creditFilters,
              eq(financeRecipient.userId, access.actor.id),
            ]),
      ),
    )
  const today = todaySaoPaulo()
  const [config] = await db
    .select({
      recipients: sql<number>`(SELECT count(*) FROM ${financeRecipient})::int`,
      activeRules: sql<number>`(
        SELECT count(*)
        FROM ${financeRule}
        WHERE ${financeRule.status} = 'ATIVA'
          AND ${financeRule.validFrom} <= ${today}
          AND (${financeRule.validTo} IS NULL OR ${financeRule.validTo} >= ${today})
      )::int`,
    })
    .from(sql`(SELECT 1) AS one`)
  const reserves = access.isGlobal ? await reserveBalances(access) : []
  const due = Number(credits?.dueCents ?? 0)
  const paid = Number(credits?.paidCents ?? 0)
  return {
    receipts: {
      count: receipts?.count ?? 0,
      grossCents: Number(receipts?.grossCents ?? 0),
      draft: receipts?.draft ?? 0,
      blocked: receipts?.blocked ?? 0,
      ready: receipts?.ready ?? 0,
      closed: receipts?.closed ?? 0,
    },
    credits: { dueCents: due, paidCents: paid, balanceCents: due - paid },
    reservesBalanceCents: reserves.reduce((sum, r) => sum + r.balanceCents, 0),
    config: access.isGlobal
      ? {
          recipients: config?.recipients ?? 0,
          activeRules: config?.activeRules ?? 0,
        }
      : { recipients: 0, activeRules: 0 },
  }
}

// ---------------------------------------------------------------------------
// Extrato (P08)

export type StatementQuery = {
  recipientId?: string
  dateFrom?: string
  dateTo?: string
  housingComplexId?: string
  processId?: string
}

export type StatementEntry = {
  date: string
  kind: 'CREDITO' | 'AJUSTE' | 'BAIXA' | 'ESTORNO_BAIXA' | 'ESTORNO_CREDITO'
  description: string
  recipientId: string
  recipientName: string
  /** efeito no saldo a receber (credito +, baixa −) */
  amountCents: number
  balanceCents: number
  // rastreabilidade (CT-18): extrato -> credito/baixa -> fechamento -> memoria ->
  // regra/versao -> recebimento -> processo
  creditId: string
  payoutId: string | null
  adjustmentId: string | null
  closingId: string
  closingCode: string
  closingLineId: string
  stepCode: string
  ruleId: string | null
  ruleVersion: number | null
  receiptId: string
  processId: string
  processCode: string
  clientName: string
  housingComplexName: string | null
  reference: string
  sortKey: string
}

export async function getStatement(
  access: FinanceAccess,
  query: StatementQuery,
) {
  assertFinance(access, 'view')
  const filters: SQL[] = []
  if (access.processFilter) filters.push(access.processFilter)
  if (!access.isGlobal) {
    filters.push(eq(financeRecipient.userId, access.actor.id))
  }
  if (query.recipientId)
    filters.push(eq(financeCredit.recipientId, query.recipientId))
  if (query.processId)
    filters.push(eq(financeCredit.processId, query.processId))
  if (query.housingComplexId) {
    filters.push(eq(financeCredit.housingComplexId, query.housingComplexId))
  }
  const credits = await db
    .select({
      credit: financeCredit,
      closingCode: financeClosing.code,
      closingCreatedAt: financeClosing.createdAt,
      closingReversedAt: financeClosing.reversedAt,
      stepCode: financeClosingLine.code,
      stepDescription: financeClosingLine.description,
      ruleId: financeClosingLine.ruleId,
      ruleVersion: financeClosingLine.ruleVersion,
      recipientName: financeRecipient.name,
      processCode: process.code,
      clientName: process.fullName,
      housingComplexName: housingComplex.name,
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
  const creditIds = credits.map((row) => row.credit.id)
  const [payouts, adjustments] = creditIds.length
    ? await Promise.all([
        db
          .select()
          .from(financePayout)
          .where(inArray(financePayout.creditId, creditIds)),
        db
          .select()
          .from(financeAdjustment)
          .where(inArray(financeAdjustment.creditId, creditIds)),
      ])
    : [[], []]

  const entries: StatementEntry[] = []
  for (const row of credits) {
    const trace = {
      recipientId: row.credit.recipientId,
      recipientName: row.recipientName,
      creditId: row.credit.id,
      closingId: row.credit.closingId,
      closingCode: row.closingCode,
      closingLineId: row.credit.closingLineId,
      stepCode: row.stepCode,
      ruleId: row.ruleId,
      ruleVersion: row.ruleVersion,
      receiptId: row.credit.receiptId,
      processId: row.credit.processId,
      processCode: row.processCode,
      clientName: row.clientName,
      housingComplexName: row.housingComplexName,
    }
    entries.push({
      ...trace,
      date: toSaoPauloDate(row.closingCreatedAt),
      kind: 'CREDITO',
      description: `Crédito ${row.stepCode} · ${row.stepDescription}`,
      amountCents: row.credit.amountCents,
      balanceCents: 0,
      payoutId: null,
      adjustmentId: null,
      reference: row.closingCode,
      sortKey: `${row.closingCreatedAt.toISOString()}|1|${row.credit.id}`,
    })
    if (row.credit.status === 'ESTORNADO' && row.closingReversedAt) {
      entries.push({
        ...trace,
        date: toSaoPauloDate(row.closingReversedAt),
        kind: 'ESTORNO_CREDITO',
        description: `Estorno do fechamento ${row.closingCode}`,
        amountCents: -(row.credit.amountCents + row.credit.adjustedCents),
        balanceCents: 0,
        payoutId: null,
        adjustmentId: null,
        reference: row.closingCode,
        sortKey: `${row.closingReversedAt.toISOString()}|4|${row.credit.id}`,
      })
    }
    for (const adjustment of adjustments.filter(
      (a) => a.creditId === row.credit.id,
    )) {
      entries.push({
        ...trace,
        date: toSaoPauloDate(adjustment.createdAt),
        kind: 'AJUSTE',
        description: `Ajuste: ${adjustment.reason}`,
        amountCents: adjustment.amountCents,
        balanceCents: 0,
        payoutId: null,
        adjustmentId: adjustment.id,
        reference: '',
        sortKey: `${adjustment.createdAt.toISOString()}|2|${adjustment.id}`,
      })
    }
    for (const payout of payouts.filter((p) => p.creditId === row.credit.id)) {
      entries.push({
        ...trace,
        date: payout.paidOn,
        kind: 'BAIXA',
        description: `Pagamento registrado (${payout.reference})`,
        amountCents: -payout.amountCents,
        balanceCents: 0,
        payoutId: payout.id,
        adjustmentId: null,
        reference: payout.reference,
        sortKey: `${payout.createdAt.toISOString()}|3|${payout.id}`,
      })
      if (payout.status === 'ESTORNADO' && payout.reversedAt) {
        entries.push({
          ...trace,
          date: toSaoPauloDate(payout.reversedAt),
          kind: 'ESTORNO_BAIXA',
          description: `Estorno da baixa (${payout.reversalReason ?? ''})`,
          amountCents: payout.amountCents,
          balanceCents: 0,
          payoutId: payout.id,
          adjustmentId: null,
          reference: payout.reference,
          sortKey: `${payout.reversedAt.toISOString()}|5|${payout.id}`,
        })
      }
    }
  }
  entries.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.sortKey < b.sortKey
        ? -1
        : a.sortKey > b.sortKey
          ? 1
          : 0,
  )
  // Saldo anterior ao periodo + movimentos do periodo, acumulado por recebedor.
  const running = new Map<string, number>()
  const opening = new Map<string, number>()
  const inPeriod: StatementEntry[] = []
  for (const entry of entries) {
    const balance = (running.get(entry.recipientId) ?? 0) + entry.amountCents
    running.set(entry.recipientId, balance)
    if (query.dateFrom && entry.date < query.dateFrom) {
      opening.set(entry.recipientId, balance)
      continue
    }
    if (query.dateTo && entry.date > query.dateTo) continue
    inPeriod.push({ ...entry, balanceCents: balance })
  }
  const sum = (kinds: StatementEntry['kind'][]) =>
    inPeriod
      .filter((entry) => kinds.includes(entry.kind))
      .reduce((total, entry) => total + entry.amountCents, 0)
  const openingCents = [...opening.values()].reduce((a, b) => a + b, 0)
  return {
    entries: inPeriod,
    totals: {
      openingCents,
      creditsCents: sum(['CREDITO', 'AJUSTE', 'ESTORNO_CREDITO']),
      paidCents: -sum(['BAIXA', 'ESTORNO_BAIXA']),
      closingBalanceCents:
        openingCents +
        inPeriod.reduce((total, entry) => total + entry.amountCents, 0),
    },
  }
}

export async function listStatementRecipientOptions(
  access: FinanceAccess,
) {
  assertFinance(access, 'view')
  const filters: SQL[] = []
  if (access.processFilter) filters.push(access.processFilter)
  if (!access.isGlobal) {
    filters.push(eq(financeRecipient.userId, access.actor.id))
  }

  return db
    .select({
      id: financeRecipient.id,
      name: financeRecipient.name,
    })
    .from(financeCredit)
    .innerJoin(
      financeRecipient,
      eq(financeCredit.recipientId, financeRecipient.id),
    )
    .innerJoin(process, eq(financeCredit.processId, process.id))
    .where(filters.length ? and(...filters) : undefined)
    .groupBy(financeRecipient.id, financeRecipient.name)
    .orderBy(asc(financeRecipient.name), asc(financeRecipient.id))
}

const csvHeader = [
  'Data',
  'Tipo',
  'Recebedor',
  'Descrição',
  'Valor',
  'Saldo',
  'Processo',
  'Cliente',
  'Condomínio',
  'Fechamento',
  'Etapa',
  'Regra',
  'Versão',
  'Recebimento',
  'Referência',
]

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  // Neutraliza injecao de formula em planilhas (=, +, -, @ no inicio).
  const safe = /^[=+\-@]/.test(text) && !/^-?R\$/.test(text) ? `'${text}` : text
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function brDate(date: string) {
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

/** CSV pt-BR (separador ;, BOM UTF-8) do extrato. */
export async function exportStatementCsv(
  access: FinanceAccess,
  query: StatementQuery,
) {
  assertFinance(access, 'exportar')
  const statement = await getStatement(access, query)
  const lines = [csvHeader.join(';')]
  for (const entry of statement.entries) {
    lines.push(
      [
        brDate(entry.date),
        entry.kind,
        entry.recipientName,
        entry.description,
        formatCentsBRL(entry.amountCents),
        formatCentsBRL(entry.balanceCents),
        entry.processCode,
        entry.clientName,
        entry.housingComplexName,
        entry.closingCode,
        entry.stepCode,
        entry.ruleId,
        entry.ruleVersion,
        entry.receiptId,
        entry.reference,
      ]
        .map(csvCell)
        .join(';'),
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

// ---------------------------------------------------------------------------
// Reservas e provisoes (P10)

export async function reserveBalances(access: FinanceAccess) {
  assertFinance(access, 'view')
  const rows = await db
    .select({
      poolKey: financeReserveMovement.poolKey,
      poolLabel: sql<string>`max(${financeReserveMovement.poolLabel})`,
      nature: sql<string>`max(${financeReserveMovement.nature}::text)`,
      constitutedCents: sql<number>`coalesce(sum(${financeReserveMovement.amountCents}) FILTER (WHERE ${financeReserveMovement.kind} = 'CONSTITUICAO' AND ${financeReserveMovement.status} = 'ATIVO'), 0)::bigint`,
      spentCents: sql<number>`coalesce(sum(${financeReserveMovement.amountCents}) FILTER (WHERE ${financeReserveMovement.kind} = 'DESPESA' AND ${financeReserveMovement.status} = 'ATIVO'), 0)::bigint`,
      transferredCents: sql<number>`coalesce(sum(${financeReserveMovement.amountCents}) FILTER (WHERE ${financeReserveMovement.kind} = 'TRANSFERENCIA' AND ${financeReserveMovement.status} = 'ATIVO'), 0)::bigint`,
      movements: sql<number>`count(*)::int`,
    })
    .from(financeReserveMovement)
    .groupBy(financeReserveMovement.poolKey)
    .orderBy(asc(financeReserveMovement.poolKey))
  return rows.map((row) => {
    const constituted = Number(row.constitutedCents)
    const spent = Number(row.spentCents)
    const transferred = Number(row.transferredCents)
    return {
      poolKey: row.poolKey,
      poolLabel: row.poolLabel,
      nature: row.nature,
      constitutedCents: constituted,
      spentCents: spent,
      transferredCents: transferred,
      balanceCents: constituted - spent - transferred,
      movements: row.movements,
    }
  })
}

export async function listReserveMovements(
  access: FinanceAccess,
  query: { poolKey?: string; processId?: string },
) {
  assertFinance(access, 'view')
  const filters: SQL[] = []
  if (query.poolKey)
    filters.push(eq(financeReserveMovement.poolKey, query.poolKey))
  if (query.processId) {
    filters.push(eq(financeReserveMovement.processId, query.processId))
  }
  if (access.processFilter) {
    // Sem escopo total, so movimentos de processos visiveis (nunca os globais).
    filters.push(access.processFilter)
  }
  return db
    .select({
      movement: financeReserveMovement,
      processCode: process.code,
      closingCode: financeClosing.code,
    })
    .from(financeReserveMovement)
    .leftJoin(process, eq(financeReserveMovement.processId, process.id))
    .leftJoin(
      financeClosing,
      eq(financeReserveMovement.closingId, financeClosing.id),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(
      asc(financeReserveMovement.movementDate),
      asc(financeReserveMovement.createdAt),
    )
}

export type ReserveDebitInput = {
  poolKey: string
  processId?: string | null
  kind: 'DESPESA' | 'TRANSFERENCIA'
  amountCents: number
  movementDate: string
  description: string
  reference?: string
  destination?: string
}

async function poolBalance(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  poolKey: string,
  processId: string | null,
  atDate?: string,
) {
  const signed = sql<number>`coalesce(sum(CASE WHEN ${financeReserveMovement.kind} = 'CONSTITUICAO' THEN ${financeReserveMovement.amountCents} ELSE -${financeReserveMovement.amountCents} END), 0)::bigint`
  const [row] = await tx
    .select({ balance: signed })
    .from(financeReserveMovement)
    .where(
      and(
        eq(financeReserveMovement.poolKey, poolKey),
        eq(financeReserveMovement.status, 'ATIVO'),
        processId ? eq(financeReserveMovement.processId, processId) : undefined,
        atDate
          ? lte(financeReserveMovement.movementDate, atDate)
          : undefined,
      ),
    )
  return Number(row?.balance ?? 0)
}

/**
 * Gasto efetivo ou transferencia: reduz o saldo da RESERVA e nunca a receita
 * (CT-15). Serializado por reserva (trigger) e sem saldo inexistente.
 */
export async function createReserveDebit(
  access: FinanceAccess,
  input: ReserveDebitInput & { idempotencyKey: string },
) {
  assertFinance(access, 'reservas', { global: true })
  if (!input.description.trim()) {
    throw new FinanceServiceError(
      422,
      'Informe a origem/justificativa do movimento.',
    )
  }
  if (input.movementDate > todaySaoPaulo()) {
    throw new FinanceServiceError(
      422,
      'A data do movimento não pode ser futura.',
    )
  }
  if (input.kind === 'TRANSFERENCIA' && !input.destination?.trim()) {
    throw new FinanceServiceError(
      422,
      'Informe o destino da transferência.',
    )
  }
  const requestHash = hashPayload({ ...input, idempotencyKey: undefined })
  const replay = async () => {
    const [existing] = await db
      .select()
      .from(financeReserveMovement)
      .where(eq(financeReserveMovement.idempotencyKey, input.idempotencyKey))
    if (!existing) return null
    if (existing.requestHash !== requestHash) {
      throw new FinanceServiceError(
        409,
        'Chave de idempotência já usada com outro movimento.',
      )
    }
    return { movement: existing, replayed: true }
  }
  const previous = await replay()
  if (previous) return previous
  try {
    const movement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`finance_reserve:${input.poolKey}`}))`,
      )
      const [pool] = await tx
        .select({
          poolLabel: financeReserveMovement.poolLabel,
          nature: financeReserveMovement.nature,
          uniquePerProcess: financeReserveMovement.uniquePerProcess,
        })
        .from(financeReserveMovement)
        .where(
          and(
            eq(financeReserveMovement.poolKey, input.poolKey),
            eq(financeReserveMovement.kind, 'CONSTITUICAO'),
          ),
        )
        .limit(1)
      if (!pool) {
        throw new FinanceServiceError(
          404,
          'Reserva sem constituição: movimento sem origem.',
        )
      }
      if (pool.uniquePerProcess && !input.processId) {
        throw new FinanceServiceError(
          422,
          'Esta reserva é única por processo: informe o processo.',
        )
      }
      const balance = await poolBalance(
        tx,
        input.poolKey,
        input.processId ?? null,
        input.movementDate,
      )
      const problem = validateReserveDebit(balance, input.amountCents)
      if (problem) throw new FinanceServiceError(422, problem)
      const [created] = await tx
        .insert(financeReserveMovement)
        .values({
          id: crypto.randomUUID(),
          poolKey: input.poolKey,
          poolLabel: pool.poolLabel,
          nature: pool.nature,
          kind: input.kind,
          uniquePerProcess: false,
          amountCents: input.amountCents,
          processId: input.processId ?? null,
          movementDate: input.movementDate,
          description: input.description.trim(),
          reference: input.reference?.trim() ?? '',
          destination: input.destination?.trim() ?? '',
          idempotencyKey: input.idempotencyKey,
          requestHash,
          createdByUserId: access.actor.id,
        })
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'reserve_movement',
        entityId: created?.id as string,
        action: input.kind,
        after: { ...created, balanceAfterCents: balance - input.amountCents },
      })
      return created
    })
    return { movement, replayed: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replay()
      if (raced) return raced
    }
    mapDbError(error)
  }
}

export async function reverseReserveMovement(
  access: FinanceAccess,
  movementId: string,
  reason: string,
) {
  assertFinance(access, 'estornar', { global: true })
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(financeReserveMovement)
        .where(eq(financeReserveMovement.id, movementId))
        .for('update')
      if (!before)
        throw new FinanceServiceError(404, 'Movimento não encontrado.')
      if (before.kind === 'CONSTITUICAO') {
        throw new FinanceServiceError(
          409,
          'Constituição só é estornada pelo estorno do fechamento de origem.',
        )
      }
      if (before.status !== 'ATIVO') {
        throw new FinanceServiceError(409, 'Movimento já estornado.')
      }
      const [after] = await tx
        .update(financeReserveMovement)
        .set({
          status: 'ESTORNADO',
          reversedAt: new Date(),
          reversedByUserId: access.actor.id,
          reversalReason: reason.trim(),
        })
        .where(eq(financeReserveMovement.id, movementId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'reserve_movement',
        entityId: movementId,
        action: 'ESTORNADO',
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

export async function reserveProcessBalances(
  access: FinanceAccess,
  poolKey: string,
) {
  assertFinance(access, 'view')
  const signed = sql<number>`coalesce(sum(CASE WHEN ${financeReserveMovement.kind} = 'CONSTITUICAO' THEN ${financeReserveMovement.amountCents} ELSE -${financeReserveMovement.amountCents} END) FILTER (WHERE ${financeReserveMovement.status} = 'ATIVO'), 0)::bigint`
  const rows = await db
    .select({
      processId: financeReserveMovement.processId,
      processCode: process.code,
      balanceCents: signed,
    })
    .from(financeReserveMovement)
    .leftJoin(process, eq(financeReserveMovement.processId, process.id))
    .where(
      and(
        eq(financeReserveMovement.poolKey, poolKey),
        access.processFilter
          ? access.processFilter
          : or(isNull(financeReserveMovement.processId), sql`true`),
      ),
    )
    .groupBy(financeReserveMovement.processId, process.code)
  return rows.map((row) => ({ ...row, balanceCents: Number(row.balanceCents) }))
}
