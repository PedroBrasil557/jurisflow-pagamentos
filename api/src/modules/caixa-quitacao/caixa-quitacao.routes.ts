import { type Context, Hono, type Next } from 'hono'
import { env } from '../../shared/config/env'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { jsonValidator } from '../../shared/validation/validators'
import { quitacaoResultSchema } from './caixa-quitacao.schemas'
import {
  claimNextQuitacaoJob,
  recordQuitacaoResult,
} from './caixa-quitacao.service'

// Endpoints internos (worker RPA) — autenticados por token de servico, NAO por
// sessao de usuario. Montados sob /api/internal/caixa-quitacao.
function requireInternalToken() {
  return async (c: Context<AppBindings>, next: Next) => {
    const token = c.req.header('x-internal-token')
    if (!token || token !== env.internalApiToken) {
      return c.json({ message: 'Nao autorizado.' }, 401)
    }
    await next()
  }
}

export const caixaQuitacaoInternalRoutes = new Hono<AppBindings>()
  .use('*', requireInternalToken())
  .post('/claim', async (c) => {
    try {
      const job = await claimNextQuitacaoJob()
      return c.json({ job }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/result', jsonValidator(quitacaoResultSchema), async (c) => {
    try {
      const result = await recordQuitacaoResult(c.req.valid('json'))
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
