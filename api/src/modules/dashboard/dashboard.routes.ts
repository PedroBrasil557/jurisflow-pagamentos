import { Hono } from 'hono'
import { requireAuth } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { getDashboardStats } from './dashboard.service'

export const dashboardRoutes = new Hono<AppBindings>()
  .use(requireAuth())
  .get('/stats', async (c) => {
    try {
      const stats = await getDashboardStats()
      return c.json(stats, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
