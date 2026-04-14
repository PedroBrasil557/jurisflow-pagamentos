import { Hono } from 'hono'
import {
  getAuthenticatedUser,
  requireAuth,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  assertCanAccessDashboard,
  resolveUserPermissions,
} from '../permissions/permissions.service'
import { getDashboardStats } from './dashboard.service'

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
