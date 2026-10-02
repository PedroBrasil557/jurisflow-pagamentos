import {
  and,
  asc,
  desc,
  eq,
  ilike,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../shared/db'
import { getAuthenticatedUser, requireAuth } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { queryValidator } from '../../shared/validation/validators'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import { getClosingDetail } from './finance.closings.service'
import { previewOpenReceiptCoverage } from './finance.coverage.service'
import {
  financeClosing,
  financeClosingItem,
  financeClosingLine,
  financeCredit,
  financeReceipt,
  financeRecipient,
  financeReserveMovement,
  financeRule,
} from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  resolveFinanceAccess,
  todaySaoPaulo,
} from './finance.support'

async function access(c: Context<AppBindings>) {
  const user = getAuthenticatedUser(c)
  return resolveFinanceAccess({
    id: user.id,
    role: user.role,
    requestId: c.get('requestId'),
  })
}

function visibleProcessFilter(access: FinanceAccess): SQL | undefined {
  return access.processFilter
}

export async function reserveBalancesScoped(access: FinanceAccess) {
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
    .leftJoin(process, eq(financeReserveMovement.processId, process.id))
    .where(visibleProcessFilter(access))
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

export async function overviewScoped(access: FinanceAccess) {
  assertFinance(access, 'view')
  const visible = visibleProcessFilter(access)

  const [receipts] = await db
    .select({
      count: sql<number>`count(*)::int`,
      grossCents: sql<number>`coalesce(sum(${financeReceipt.amountCents}) FILTER (WHERE ${financeReceipt.status} <> 'CANCELADO'), 0)::bigint`,
      receivedCents: sql<number>`coalesce(sum(${financeReceipt.amountCents}) FILTER (WHERE ${financeReceipt.status} <> 'CANCELADO' AND ${financeReceipt.releaseDate} IS NOT NULL), 0)::bigint`,
      draft: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} IN ('RASCUNHO', 'EM_PREVIA'))::int`,
      blocked: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} = 'BLOQUEADO')::int`,
      ready: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} = 'APTO')::int`,
      closed: sql<number>`count(*) FILTER (WHERE ${financeReceipt.status} = 'FECHADO')::int`,
    })
    .from(financeReceipt)
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(visible)

  const [credits] = await db
    .select({
      allocatedCents: sql<number>`coalesce(sum(${financeCredit.amountCents}) FILTER (WHERE ${financeCredit.status} <> 'ESTORNADO'), 0)::bigint`,
      dueCents: sql<number>`coalesce(sum(${financeCredit.amountCents} + ${financeCredit.adjustedCents}) FILTER (WHERE ${financeCredit.status} <> 'ESTORNADO'), 0)::bigint`,
      paidCents: sql<number>`coalesce(sum(${financeCredit.paidCents}) FILTER (WHERE ${financeCredit.status} <> 'ESTORNADO'), 0)::bigint`,
    })
    .from(financeCredit)
    .innerJoin(process, eq(financeCredit.processId, process.id))
    .where(visible)

  const [rated] = await db
    .select({
      grossCents: sql<number>`coalesce(sum(${financeReceipt.amountCents}), 0)::bigint`,
    })
    .from(financeClosingItem)
    .innerJoin(financeReceipt, eq(financeClosingItem.receiptId, financeReceipt.id))
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(
      visible
        ? and(eq(financeClosingItem.isActive, true), visible)
        : eq(financeClosingItem.isActive, true),
    )

  const reserves = await reserveBalancesScoped(access)
  const coveragePreview = await previewOpenReceiptCoverage(access)
  const provisionCents = reserves
    .filter((pool) => pool.nature === 'PROVISAO')
    .reduce((sum, pool) => sum + pool.constitutedCents, 0)
  const reserveCents = reserves
    .filter((pool) => pool.nature === 'RESERVA')
    .reduce((sum, pool) => sum + pool.constitutedCents, 0)

  const dueCents = Number(credits?.dueCents ?? 0)
  const paidCents = Number(credits?.paidCents ?? 0)
  const recipientAllocatedCents = Number(credits?.allocatedCents ?? 0)
  const ratedCents = Number(rated?.grossCents ?? 0)
  const receivedCents = Number(receipts?.receivedCents ?? 0)
  const allocatedCents = provisionCents + reserveCents + recipientAllocatedCents
  const differenceCents = ratedCents - allocatedCents

  const coveredCents = Math.min(
    receivedCents,
    ratedCents + coveragePreview.coveredCents,
  )
  const uncoveredCents = Math.max(0, receivedCents - coveredCents)
  const coverageBasisPoints =
    receivedCents > 0
      ? Math.min(10_000, Math.round((coveredCents * 10_000) / receivedCents))
      : 0

  let config = { recipients: 0, activeRules: 0 }
  if (access.isGlobal) {
    const today = todaySaoPaulo()
    const [row] = await db
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
    config = {
      recipients: row?.recipients ?? 0,
      activeRules: row?.activeRules ?? 0,
    }
  }

  return {
    receipts: {
      count: receipts?.count ?? 0,
      grossCents: Number(receipts?.grossCents ?? 0),
      receivedCents,
      ratedCents,
      pendingRateioCents: Math.max(0, receivedCents - ratedCents),
      draft: receipts?.draft ?? 0,
      blocked: receipts?.blocked ?? 0,
      ready: receipts?.ready ?? 0,
      closed: receipts?.closed ?? 0,
    },
    credits: {
      dueCents,
      paidCents,
      balanceCents: dueCents - paidCents,
    },
    reservesBalanceCents: reserves.reduce((sum, row) => sum + row.balanceCents, 0),
    allocations: {
      provisionCents,
      reserveCents,
      recipientCents: recipientAllocatedCents,
      allocatedCents,
      differenceCents,
      balanced: differenceCents === 0,
    },
    coverage: {
      receivedCents,
      coveredCents,
      uncoveredCents,
      coverageBasisPoints,
      complete:
        receivedCents > 0 &&
        uncoveredCents === 0 &&
        !coveragePreview.inconsistent,
      inconsistent: coveragePreview.inconsistent,
      inconsistentReceipts: coveragePreview.inconsistentReceipts,
      pendingReceipts: coveragePreview.pendingReceipts,
      finalizedCents: ratedCents,
      projectedCents: coveragePreview.coveredCents,
      provisionCents: provisionCents + coveragePreview.provisionCents,
      reserveCents: reserveCents + coveragePreview.reserveCents,
      recipientCents:
        recipientAllocatedCents + coveragePreview.recipientCents,
    },
    config,
  }
}

export async function closingsScoped(access: FinanceAccess) {
  assertFinance(access, 'view')
  if (access.isGlobal || !access.processFilter) {
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

  return db
    .select({
      id: financeClosing.id,
      code: financeClosing.code,
      status: financeClosing.status,
      periodStart: financeClosing.periodStart,
      periodEnd: financeClosing.periodEnd,
      receiptCount: sql<number>`count(DISTINCT ${financeClosingItem.receiptId})::int`,
      grossCents: sql<number>`coalesce(sum(${financeReceipt.amountCents}), 0)::bigint`,
      createdAt: financeClosing.createdAt,
      reversedAt: financeClosing.reversedAt,
    })
    .from(financeClosing)
    .innerJoin(
      financeClosingItem,
      eq(financeClosingItem.closingId, financeClosing.id),
    )
    .innerJoin(financeReceipt, eq(financeClosingItem.receiptId, financeReceipt.id))
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(access.processFilter)
    .groupBy(
      financeClosing.id,
      financeClosing.code,
      financeClosing.status,
      financeClosing.periodStart,
      financeClosing.periodEnd,
      financeClosing.createdAt,
      financeClosing.reversedAt,
    )
    .orderBy(desc(financeClosing.createdAt))
    .limit(200)
}

export async function closingDetailScoped(
  access: FinanceAccess,
  closingId: string,
) {
  const detail = await getClosingDetail(access, closingId)
  if (access.isGlobal || !access.processFilter) return detail

  const [summary] = await db
    .select({
      receiptCount: sql<number>`count(DISTINCT ${financeClosingItem.receiptId})::int`,
      grossCents: sql<number>`coalesce(sum(${financeReceipt.amountCents}), 0)::bigint`,
    })
    .from(financeClosingItem)
    .innerJoin(financeReceipt, eq(financeClosingItem.receiptId, financeReceipt.id))
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(and(eq(financeClosingItem.closingId, closingId), access.processFilter))

  return {
    ...detail,
    closing: {
      ...detail.closing,
      receiptCount: summary?.receiptCount ?? 0,
      grossCents: Number(summary?.grossCents ?? 0),
      totals: null,
      rulesSnapshot: null,
    },
  }
}

const paymentRecipientsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export async function paymentRecipientsScoped(
  access: FinanceAccess,
  query: z.infer<typeof paymentRecipientsQuerySchema>,
) {
  assertFinance(access, 'view')
  const filters: SQL[] = [ne(financeCredit.status, 'ESTORNADO')]
  if (access.processFilter) filters.push(access.processFilter)
  if (!access.perms.isAdmin) {
    filters.push(eq(financeRecipient.userId, access.actor.id))
  }
  if (query.search) {
    const term = `%${query.search}%`
    filters.push(
      or(
        ilike(financeRecipient.name, term),
        ilike(financeClosingLine.workType, term),
        ilike(process.code, term),
        ilike(process.fullName, term),
        ilike(housingComplex.name, term),
      ) as SQL,
    )
  }
  const where = and(...filters)
  const offset = (query.page - 1) * query.limit

  const [items, [summary]] = await Promise.all([
    db
      .select({
        recipientId: financeCredit.recipientId,
        recipientName: financeRecipient.name,
        dueCents: sql<number>`coalesce(sum(${financeCredit.amountCents} + ${financeCredit.adjustedCents}), 0)::bigint`,
        paidCents: sql<number>`coalesce(sum(${financeCredit.paidCents}), 0)::bigint`,
        creditCount: sql<number>`count(*)::int`,
        workTypes: sql<string[]>`coalesce(array_agg(DISTINCT nullif(btrim(${financeClosingLine.workType}), '')) FILTER (WHERE btrim(${financeClosingLine.workType}) <> ''), ARRAY[]::text[])`,
      })
      .from(financeCredit)
      .innerJoin(
        financeRecipient,
        eq(financeCredit.recipientId, financeRecipient.id),
      )
      .innerJoin(
        financeClosingLine,
        eq(financeCredit.closingLineId, financeClosingLine.id),
      )
      .innerJoin(process, eq(financeCredit.processId, process.id))
      .leftJoin(
        housingComplex,
        eq(financeCredit.housingComplexId, housingComplex.id),
      )
      .where(where)
      .groupBy(financeCredit.recipientId, financeRecipient.name)
      .orderBy(asc(financeRecipient.name), asc(financeCredit.recipientId))
      .limit(query.limit)
      .offset(offset),
    db
      .select({
        total: sql<number>`count(DISTINCT ${financeCredit.recipientId})::int`,
        dueCents: sql<number>`coalesce(sum(${financeCredit.amountCents} + ${financeCredit.adjustedCents}), 0)::bigint`,
        paidCents: sql<number>`coalesce(sum(${financeCredit.paidCents}), 0)::bigint`,
      })
      .from(financeCredit)
      .innerJoin(
        financeRecipient,
        eq(financeCredit.recipientId, financeRecipient.id),
      )
      .innerJoin(
        financeClosingLine,
        eq(financeCredit.closingLineId, financeClosingLine.id),
      )
      .innerJoin(process, eq(financeCredit.processId, process.id))
      .leftJoin(
        housingComplex,
        eq(financeCredit.housingComplexId, housingComplex.id),
      )
      .where(where),
  ])

  const dueCents = Number(summary?.dueCents ?? 0)
  const paidCents = Number(summary?.paidCents ?? 0)
  const total = summary?.total ?? 0
  return {
    items: items.map((item) => {
      const due = Number(item.dueCents)
      const paid = Number(item.paidCents)
      return {
        recipientId: item.recipientId,
        recipientName: item.recipientName,
        workTypes: item.workTypes,
        creditCount: item.creditCount,
        dueCents: due,
        paidCents: paid,
        balanceCents: due - paid,
      }
    }),
    totals: {
      dueCents,
      paidCents,
      balanceCents: dueCents - paidCents,
    },
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  }
}

/**
 * Leituras endurecidas registradas antes das rotas legadas. Elas mantêm os
 * contratos existentes de overview/closings/reserves, mas passam a respeitar
 * integralmente o escopo de processos do usuário e expõem o consolidado de
 * pagamentos paginado no servidor.
 */
export const financeHardeningRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get('/overview', async (c) => {
    try {
      return c.json(await overviewScoped(await access(c)), 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/closings', async (c) => {
    try {
      return c.json({ items: await closingsScoped(await access(c)) }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/closings/:id', async (c) => {
    try {
      return c.json(
        await closingDetailScoped(await access(c), c.req.param('id')),
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/reserves', async (c) => {
    try {
      return c.json({ items: await reserveBalancesScoped(await access(c)) }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get(
    '/payment-recipients',
    queryValidator(paymentRecipientsQuerySchema),
    async (c) => {
      try {
        return c.json(
          await paymentRecipientsScoped(
            await access(c),
            c.req.valid('query'),
          ),
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
