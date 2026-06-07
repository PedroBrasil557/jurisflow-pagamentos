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

// Converte o filtro de periodo (preset ou intervalo) em [from, to].
function resolvePeriodRange(query: z.infer<typeof periodQuerySchema>): {
  from: Date
  to: Date
} {
  if (query.from && query.to) {
    const to = new Date(query.to)
    to.setHours(23, 59, 59, 999)
    return { from: query.from, to }
  }

  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - periodToDays[query.period])
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
