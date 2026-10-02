import { and, asc, eq, gte, isNull, lte, ne, or, type SQL, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../shared/db'
import { getAuthenticatedUser, requireAuth } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { jsonValidator, queryValidator } from '../../shared/validation/validators'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import { listCredits } from './finance.closings.service'
import { paymentRecipientsScoped } from './finance.hardening.routes'
import {
  financeClosingLine,
  financeCredit,
  financeRecipient,
  financeRule,
  financeRuleHousingComplex,
} from './finance.schema'
import {
  assertFinance,
  FinanceServiceError,
  resolveFinanceAccess,
  todaySaoPaulo,
  writeAudit,
} from './finance.support'

async function access(c: Context<AppBindings>) {
  const actor = getAuthenticatedUser(c)
  return resolveFinanceAccess({
    id: actor.id,
    role: actor.role,
    requestId: c.get('requestId'),
  })
}

const paymentRecipientsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

const linkUserSchema = z.object({
  recipientId: z.string().trim().min(1).max(64),
  userId: z.string().trim().min(1).max(128).nullable(),
})

const creditQuerySchema = z.object({
  closingId: z.string().trim().min(1).max(64).optional(),
  recipientId: z.string().trim().min(1).max(64).optional(),
  processId: z.string().trim().min(1).max(64).optional(),
  status: z
    .union([
      z.enum(['ABERTO', 'PARCIALMENTE_PAGO', 'PAGO', 'ESTORNADO']),
      z.array(z.enum(['ABERTO', 'PARCIALMENTE_PAGO', 'PAGO', 'ESTORNADO'])),
    ])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),
})

async function ownPaymentRecipients(
  financeAccess: Awaited<ReturnType<typeof access>>,
  query: z.infer<typeof paymentRecipientsQuerySchema>,
) {
  const filters: SQL[] = [
    ne(financeCredit.status, 'ESTORNADO'),
    eq(financeRecipient.userId, financeAccess.actor.id),
  ]
  if (financeAccess.processFilter) filters.push(financeAccess.processFilter)
  const where = and(...filters)

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
      .innerJoin(financeRecipient, eq(financeCredit.recipientId, financeRecipient.id))
      .innerJoin(financeClosingLine, eq(financeCredit.closingLineId, financeClosingLine.id))
      .innerJoin(process, eq(financeCredit.processId, process.id))
      .leftJoin(housingComplex, eq(financeCredit.housingComplexId, housingComplex.id))
      .where(where)
      .groupBy(financeCredit.recipientId, financeRecipient.name)
      .orderBy(asc(financeRecipient.name)),
    db
      .select({
        total: sql<number>`count(DISTINCT ${financeCredit.recipientId})::int`,
        dueCents: sql<number>`coalesce(sum(${financeCredit.amountCents} + ${financeCredit.adjustedCents}), 0)::bigint`,
        paidCents: sql<number>`coalesce(sum(${financeCredit.paidCents}), 0)::bigint`,
      })
      .from(financeCredit)
      .innerJoin(financeRecipient, eq(financeCredit.recipientId, financeRecipient.id))
      .innerJoin(process, eq(financeCredit.processId, process.id))
      .where(where),
  ])

  const dueCents = Number(summary?.dueCents ?? 0)
  const paidCents = Number(summary?.paidCents ?? 0)
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
      page: 1,
      limit: query.limit,
      total: summary?.total ?? 0,
      totalPages: 1,
    },
  }
}

function publicGroupLabel(row: {
  stage: string
  nature: string
  workType: string
  poolLabel: string | null
}) {
  if (row.stage === 'PROVISAO_RECEITA') return row.poolLabel || 'Provisões / tributos'
  if (row.stage === 'RESERVA') return row.poolLabel || 'Reservas'
  if (row.stage === 'DEDUCAO_LIQUIDA')
    return row.workType || 'Participações sobre receita líquida'
  if (row.stage === 'PARTICIPACAO_RESULTADO')
    return row.workType || 'Participação sobre o resultado'
  return row.workType || 'Distribuição final'
}

/**
 * Rotas registradas antes das rotas financeiras legadas. Elas endurecem a
 * privacidade do recebedor sem retirar a visão total do administrador.
 */
export const financeQuickRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get(
    '/payment-recipients',
    queryValidator(paymentRecipientsQuerySchema),
    async (c) => {
      try {
        const financeAccess = await access(c)
        assertFinance(financeAccess, 'view')
        const query = c.req.valid('query')
        if (financeAccess.perms.isAdmin) {
          return c.json(await paymentRecipientsScoped(financeAccess, query), 200)
        }
        return c.json(await ownPaymentRecipients(financeAccess, query), 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get('/credits', queryValidator(creditQuerySchema), async (c) => {
    try {
      const financeAccess = await access(c)
      assertFinance(financeAccess, 'view')
      const query = c.req.valid('query')
      if (financeAccess.perms.isAdmin) {
        return c.json({ items: await listCredits(financeAccess, query) }, 200)
      }

      const owned = await db
        .select({ id: financeRecipient.id })
        .from(financeRecipient)
        .where(eq(financeRecipient.userId, financeAccess.actor.id))
      const ownedIds = owned.map((row) => row.id)
      if (
        query.recipientId &&
        !ownedIds.includes(query.recipientId)
      ) {
        throw new FinanceServiceError(
          403,
          'Você só pode consultar os seus próprios valores.',
        )
      }
      if (ownedIds.length === 0) return c.json({ items: [] }, 200)
      const ids = query.recipientId ? [query.recipientId] : ownedIds
      const lists = await Promise.all(
        ids.map((recipientId) =>
          listCredits(financeAccess, { ...query, recipientId }),
        ),
      )
      return c.json({ items: lists.flat() }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/allocation-policy', async (c) => {
    try {
      const financeAccess = await access(c)
      assertFinance(financeAccess, 'view')
      const today = todaySaoPaulo()
      const rows = await db
        .select({
          id: financeRule.id,
          stage: financeRule.stage,
          nature: financeRule.nature,
          workType: financeRule.workType,
          poolLabel: financeRule.poolLabel,
          valueType: financeRule.valueType,
          basisPoints: financeRule.basisPoints,
          fixedCents: financeRule.fixedCents,
          validFrom: financeRule.validFrom,
          validTo: financeRule.validTo,
        })
        .from(financeRule)
        .where(
          and(
            eq(financeRule.status, 'ATIVA'),
            lte(financeRule.validFrom, today),
            or(isNull(financeRule.validTo), gte(financeRule.validTo, today)),
          ),
        )
        .orderBy(asc(financeRule.stage), asc(financeRule.sortOrder))
      const links = rows.length
        ? await db
            .select({ ruleId: financeRuleHousingComplex.ruleId })
            .from(financeRuleHousingComplex)
        : []
      return c.json({
        items: rows.map((row) => ({
          id: row.id,
          group: publicGroupLabel(row),
          stage: row.stage,
          valueType: row.valueType,
          basisPoints: row.basisPoints,
          fixedCents: row.fixedCents,
          validFrom: row.validFrom,
          validTo: row.validTo,
          global: !links.some((link) => link.ruleId === row.id),
        })),
        visibility: financeAccess.perms.isAdmin ? 'ADMIN' : 'GROUPS_ONLY',
      })
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/quick/recipient-user-link',
    jsonValidator(linkUserSchema),
    async (c) => {
      try {
        const financeAccess = await access(c)
        assertFinance(financeAccess, 'regras', { global: true })
        if (!financeAccess.perms.isAdmin) {
          throw new FinanceServiceError(
            403,
            'Somente o administrador pode vincular contas aos recebedores.',
          )
        }
        const input = c.req.valid('json')
        const result = await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(financeRecipient)
            .where(eq(financeRecipient.id, input.recipientId))
            .for('update')
          if (!before) {
            throw new FinanceServiceError(404, 'Recebedor não encontrado.')
          }
          if (input.userId) {
            const [linkedUser] = await tx
              .select({ id: user.id, isActive: user.isActive })
              .from(user)
              .where(eq(user.id, input.userId))
            if (!linkedUser || !linkedUser.isActive) {
              throw new FinanceServiceError(422, 'Usuário não encontrado ou inativo.')
            }
          }
          const [after] = await tx
            .update(financeRecipient)
            .set({ userId: input.userId })
            .where(eq(financeRecipient.id, input.recipientId))
            .returning()
          await writeAudit(tx, {
            actor: financeAccess.actor,
            entityType: 'recipient',
            entityId: input.recipientId,
            action: 'USUARIO_VINCULADO',
            before: { userId: before.userId },
            after: { userId: after?.userId ?? null },
          })
          return after
        })
        return c.json({ recipient: result }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
