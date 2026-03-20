import { Hono } from 'hono'
import { adminRoutes } from '../modules/admin/admin.routes'
import { authRoutes } from '../modules/auth/auth.routes'
import { auth } from '../modules/auth/auth.service'
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes'
import {
  housingComplexAdminRoutes,
  housingComplexOptionsRoutes,
} from '../modules/housing-complexes/housing-complexes.routes'
import { processRoutes } from '../modules/processes/processes.routes'
import { systemRoutes } from '../modules/system/system.routes'
import { createCorsMiddleware } from '../shared/middleware/cors'
import { requestLogger } from '../shared/middleware/logger'
import { sessionMiddleware } from '../shared/middleware/session'
import type { AppBindings } from '../shared/types/app'

type CreateAppRouterOptions = {
  allowedOrigins: string[]
}

export function createAppRouter(options: CreateAppRouterOptions) {
  const appRouter = new Hono<AppBindings>()

  appRouter.use('/api/*', createCorsMiddleware(options.allowedOrigins))
  appRouter.use('/api/*', sessionMiddleware)
  appRouter.use('/api/*', requestLogger())

  const routes = appRouter
    .on(['POST', 'GET'], '/api/auth/*', (c) => {
      return auth.handler(c.req.raw)
    })
    .route('/api', authRoutes)
    .route('/api/admin', adminRoutes)
    .route('/api/admin/housing-complexes', housingComplexAdminRoutes)
    .route('/api/housing-complexes', housingComplexOptionsRoutes)
    .route('/api/dashboard', dashboardRoutes)
    .route('/api/processes', processRoutes)
    .route('/api/system', systemRoutes)
    .get('/', (c) => {
      return c.json(
        {
          ok: true,
          service: 'api',
        },
        200,
      )
    })

  return routes
}
