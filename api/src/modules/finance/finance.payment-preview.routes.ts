import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../shared/db'
import {
  getAuthenticatedUser,
  requireAuth,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { queryValidator } from '../../shared/validation/validators'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import { previewOpenRecipientAllocations } from './finance.coverage.service'
import {
  financeClosingLine,
  financeCredit,
  financeRecipient,
} from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  resolveFinanceAccess,
} from './finance.support'

const paymentRecipientsPreviewQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

async function access(c: Context<AppBindings>) {
  const user = getAuthenticatedUser(c)
  return resolveFinanceAccess({
    id: user.id,
    role: user.role,
    requestId: c.get('requestId'),
  })
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

type RecipientAccumulator = {
  recipientId: string
  recipientName: string
  workTypes: Set<string>
  searchTerms: Set<string>
  creditCount: number
  releasedCents: number
  paidCents: number
  awaitingDistributionCents: number
}

export async function paymentRecipientsPreviewScoped(
  accessData: FinanceAccess,
  query: z.infer<typeof paymentRecipientsPreviewQuerySchema>,
) {
  assertFinance(accessData, 'view')
  const filters: SQL[] = [ne(financeCredit.status, 'ESTORNADO')]
  if (accessData.processFilter) filters.push(accessData.processFilter)

  const [actual, projection] = await Promise.all([
    db
      .select({
        recipientId: financeCredit.recipientId,
        recipientName: financeRecipient.name,
        releasedCents: sql<number>`coalesce(sum(${financeCredit.amountCents} + ${financeCredit.adjustedCents}), 0)::bigint`,
        paidCents: sql<number>`coalesce(sum(${financeCredit.paidCents}), 0)::bigint`,
        creditCount: sql<number>`count(*)::int`,
        workTypes: sql<string[]>`coalesce(array_agg(DISTINCT nullif(btrim(${financeClosingLine.workType}), '')) FILTER (WHERE btrim(${financeClosingLine.workType}) <> ''), ARRAY[]::text[])`,
        processCodes: sql<string[]>`coalesce(array_agg(DISTINCT ${process.code}), ARRAY[]::text[])`,
        clientNames: sql<string[]>`coalesce(array_agg(DISTINCT ${process.fullName}), ARRAY[]::text[])`,
        housingComplexNames: sql<string[]>`coalesce(array_agg(DISTINCT ${housingComplex.name}) FILTER (WHERE ${housingComplex.name} IS NOT NULL), ARRAY[]::text[])`,
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
      .where(and(...filters))
      .groupBy(financeCredit.recipientId, financeRecipient.name)
      .orderBy(asc(financeRecipient.name), asc(financeCredit.recipientId)),
    previewOpenRecipientAllocations(accessData),
  ])

  const merged = new Map<string, RecipientAccumulator>()

  for (const item of actual) {
    merged.set(item.recipientId, {
      recipientId: item.recipientId,
      recipientName: item.recipientName,
      workTypes: new Set(item.workTypes),
      searchTerms: new Set([
        item.recipientName,
        ...item.workTypes,
        ...item.processCodes,
        ...item.clientNames,
        ...item.housingComplexNames,
      ]),
      creditCount: item.creditCount,
      releasedCents: Number(item.releasedCents),
      paidCents: Number(item.paidCents),
      awaitingDistributionCents: 0,
    })
  }

  for (const item of projection.items) {
    const current = merged.get(item.recipientId) ?? {
      recipientId: item.recipientId,
      recipientName: item.recipientName,
      workTypes: new Set<string>(),
      searchTerms: new Set<string>(),
      creditCount: 0,
      releasedCents: 0,
      paidCents: 0,
      awaitingDistributionCents: 0,
    }
    current.recipientName = item.recipientName
    current.awaitingDistributionCents += item.projectedCents
    for (const value of item.workTypes) current.workTypes.add(value)
    current.searchTerms.add(item.recipientName)
    for (const value of item.workTypes) current.searchTerms.add(value)
    for (const value of item.searchTerms) current.searchTerms.add(value)
    merged.set(item.recipientId, current)
  }

  const search = normalizeSearch(query.search ?? '')
  const allItems = [...merged.values()]
    .filter((item) => {
      if (!search) return true
      return [...item.searchTerms].some((term) =>
        normalizeSearch(term).includes(search),
      )
    })
    .sort((a, b) =>
      a.recipientName.localeCompare(b.recipientName, 'pt-BR'),
    )

  const totals = allItems.reduce(
    (sum, item) => {
      sum.releasedCents += item.releasedCents
      sum.paidCents += item.paidCents
      sum.awaitingDistributionCents += item.awaitingDistributionCents
      return sum
    },
    {
      releasedCents: 0,
      paidCents: 0,
      awaitingDistributionCents: 0,
    },
  )

  const total = allItems.length
  const totalPages = Math.max(1, Math.ceil(total / query.limit))
  const page = Math.min(query.page, totalPages)
  const offset = (page - 1) * query.limit
  const pageItems = allItems.slice(offset, offset + query.limit)

  return {
    items: pageItems.map((item) => ({
      recipientId: item.recipientId,
      recipientName: item.recipientName,
      workTypes: [...item.workTypes].sort(),
      creditCount: item.creditCount,
      plannedCents: item.releasedCents + item.awaitingDistributionCents,
      releasedCents: item.releasedCents,
      paidCents: item.paidCents,
      balanceCents: item.releasedCents - item.paidCents,
      awaitingDistributionCents: item.awaitingDistributionCents,
    })),
    totals: {
      plannedCents:
        totals.releasedCents + totals.awaitingDistributionCents,
      releasedCents: totals.releasedCents,
      paidCents: totals.paidCents,
      balanceCents: totals.releasedCents - totals.paidCents,
      awaitingDistributionCents: totals.awaitingDistributionCents,
    },
    preview: {
      pendingReceipts: projection.pendingReceipts,
      inconsistent: projection.inconsistent,
      inconsistentReceipts: projection.inconsistentReceipts,
    },
    pagination: {
      page,
      limit: query.limit,
      total,
      totalPages,
    },
  }
}

export const financePaymentPreviewRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get(
    '/payment-recipients-preview',
    queryValidator(paymentRecipientsPreviewQuerySchema),
    async (c) => {
      try {
        return c.json(
          await paymentRecipientsPreviewScoped(
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
