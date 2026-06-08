import { Hono } from 'hono'
import { requireRole } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  listActiveSessionsQuerySchema,
  listLoginEventsQuerySchema,
  sessionIdParamsSchema,
} from './auth-audit.schemas'
import {
  listActiveSessions,
  listLoginEvents,
  revokeSession,
} from './auth-audit.service'

export const authAuditRoutes = new Hono<AppBindings>()
  .use('*', requireRole('admin'))
  .get(
    '/login-events',
    queryValidator(listLoginEventsQuerySchema),
    async (c) => {
      try {
        const result = await listLoginEvents(c.req.valid('query'))

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/sessions',
    queryValidator(listActiveSessionsQuerySchema),
    async (c) => {
      try {
        const result = await listActiveSessions(c.req.valid('query'))

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete(
    '/sessions/:sessionId',
    paramsValidator(sessionIdParamsSchema),
    async (c) => {
      try {
        const result = await revokeSession(c.req.valid('param').sessionId)

        return c.json(
          { message: 'Sessao revogada com sucesso.', ...result },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
