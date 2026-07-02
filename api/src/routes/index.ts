import { Hono } from 'hono'
import { adminRoutes } from '../modules/admin/admin.routes'
import { authRoutes } from '../modules/auth/auth.routes'
import { auth } from '../modules/auth/auth.service'
import { authAuditRoutes } from '../modules/auth-audit/auth-audit.routes'
import { caixaQuitacaoInternalRoutes } from '../modules/caixa-quitacao/caixa-quitacao.routes'
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes'
import {
  housingComplexAdminRoutes,
  housingComplexOptionsRoutes,
} from '../modules/housing-complexes/housing-complexes.routes'
import {
  permissionProfileAdminRoutes,
  permissionUserAdminRoutes,
} from '../modules/permissions/permissions.admin.routes'
import { processRoutes } from '../modules/processes/processes.routes'
import { quitacaoQueueInternalRoutes } from '../modules/quitacao-queue/quitacao-queue.internal.routes'
import {
  settingsAdminRoutes,
  settingsClientRoutes,
} from '../modules/settings/settings.routes'
import { titularesCaixaRoutes } from '../modules/titulares-caixa/titulares-caixa.routes'
import { systemRoutes } from '../modules/system/system.routes'
import { telemetryRoutes } from '../modules/telemetry/telemetry.routes'
import { createCorsMiddleware } from '../shared/middleware/cors'
import { requestLogger } from '../shared/middleware/logger'
import { requestId } from '../shared/middleware/request-id'
import { sessionMiddleware } from '../shared/middleware/session'
import type { AppBindings } from '../shared/types/app'

type CreateAppRouterOptions = {
  allowedOrigins: string[]
}

export function createAppRouter(options: CreateAppRouterOptions) {
  const appRouter = new Hono<AppBindings>()

  appRouter.use('/api/*', requestId())
  appRouter.use('/api/*', createCorsMiddleware(options.allowedOrigins))
  appRouter.use('/api/*', sessionMiddleware)
  appRouter.use('/api/*', requestLogger())

  const routes = appRouter
    .on(['POST', 'GET'], '/api/auth/*', (c) => {
      return auth.handler(c.req.raw)
    })
    .route('/api', authRoutes)
    .route('/api/admin', adminRoutes)
    .route('/api/admin/security', authAuditRoutes)
    .route('/api/admin/housing-complexes', housingComplexAdminRoutes)
    .route('/api/admin/profiles', permissionProfileAdminRoutes)
    .route('/api/admin/users', permissionUserAdminRoutes)
    .route('/api/admin/settings', settingsAdminRoutes)
    .route('/api/settings', settingsClientRoutes)
    .route('/api/housing-complexes', housingComplexOptionsRoutes)
    .route('/api/dashboard', dashboardRoutes)
    .route('/api/processes', processRoutes)
    .route('/api/titulares-caixa', titularesCaixaRoutes)
    .route('/api/internal/caixa-quitacao', caixaQuitacaoInternalRoutes)
    .route('/api/internal/quitacao', quitacaoQueueInternalRoutes)
    .route('/api/telemetry', telemetryRoutes)
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
