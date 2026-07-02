import { Hono } from 'hono'
import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'
import {
  getAuthenticatedUser,
  requireAuth,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { queryValidator } from '../../shared/validation/validators'
import {
  assertCanAccessDashboard,
  resolveUserPermissions,
} from '../permissions/permissions.service'
import { getProductivityStats } from './dashboard.productivity.service'
import { getDashboardStats } from './dashboard.service'
import { getStageTimingStats } from './dashboard.stage-timings.service'
import { getTitularCaixaStats } from './dashboard.titular-caixa.service'

const periodQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

const periodToDays: Record<'7d' | '30d' | '90d', number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

// O frontend envia datas "YYYY-MM-DD" (dia no fuso de Brasilia), que z.coerce.date()
// parseia como meia-noite UTC; recuperamos os componentes via getUTC*. America/Sao_Paulo
// e fixo em UTC-3 (sem horario de verao desde 2019), entao ancorar o intervalo nesse
// offset deixa o filtro correto independentemente do TZ do container (prod roda em UTC,
// maquinas locais nao) e alinhado ao dia civil de Brasilia.
const SAO_PAULO_UTC_OFFSET = '-03:00'

function brazilDayBoundary(date: Date, edge: 'start' | 'end'): Date {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const time = edge === 'start' ? '00:00:00.000' : '23:59:59.999'
  return new Date(`${year}-${month}-${day}T${time}${SAO_PAULO_UTC_OFFSET}`)
}

// Converte o filtro de periodo (preset ou intervalo) em [from, to].
function resolvePeriodRange(query: z.infer<typeof periodQuerySchema>): {
  from: Date
  to: Date
} {
  // Sem from nem to: usa o preset (ultimos N dias ate agora).
  if (!query.from && !query.to) {
    const to = new Date()
    const from = new Date(to)
    from.setDate(from.getDate() - periodToDays[query.period])
    return { from, to }
  }

  // Intervalo custom — aceita from-only ("a partir de X ate agora") e to-only,
  // alem de ambos. Cada borda informada e ancorada no dia civil de Brasilia; a
  // borda ausente cai em "ate agora" (to) ou "N dias antes do to" (from).
  const to = query.to ? brazilDayBoundary(query.to, 'end') : new Date()
  let from: Date
  if (query.from) {
    from = brazilDayBoundary(query.from, 'start')
  } else {
    from = new Date(to)
    from.setDate(from.getDate() - periodToDays[query.period])
  }
  return { from, to }
}

export const dashboardRoutes = new Hono<AppBindings>()
  .use(requireAuth())
  .get('/stats', async (c) => {
    try {
      const currentUser = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(
        currentUser.id,
        currentUser.role,
      )
      assertCanAccessDashboard(perms)
      const stats = await getDashboardStats(currentUser.id, perms)
      return c.json(stats, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/productivity', queryValidator(periodQuerySchema), async (c) => {
    try {
      const currentUser = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(
        currentUser.id,
        currentUser.role,
      )

      if (!perms.isAdmin) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para acessar os indicadores de produtividade.',
        )
      }

      const query = c.req.valid('query')
      const { from, to } = resolvePeriodRange(query)

      const stats = await getProductivityStats(from, to)
      return c.json({ period: query.period, ...stats }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/titular-caixa-stats', async (c) => {
    try {
      const currentUser = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(
        currentUser.id,
        currentUser.role,
      )

      if (!perms.isAdmin) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para acessar os indicadores de Titular Caixa.',
        )
      }

      const stats = await getTitularCaixaStats()
      return c.json(stats, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/stage-timings', queryValidator(periodQuerySchema), async (c) => {
    try {
      const currentUser = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(
        currentUser.id,
        currentUser.role,
      )

      if (!perms.isAdmin) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para acessar os indicadores de tempo entre etapas.',
        )
      }

      const query = c.req.valid('query')
      const { from, to } = resolvePeriodRange(query)

      const stats = await getStageTimingStats(from, to)
      return c.json({ period: query.period, ...stats }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
