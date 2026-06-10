import type { Context } from 'hono'
import { ServiceError } from '../errors/service-error'
import { logErrorEvent } from '../observability/log'
import type { AppBindings } from '../types/app'

export function handleServiceError(c: Context<AppBindings>, error: unknown) {
  if (error instanceof ServiceError) {
    return c.json({ message: error.message }, error.statusCode)
  }

  // Erro inesperado: registra com contexto (requestId, rota, usuario, stack) em
  // vez de re-lancar mudo, e devolve o requestId para correlacao com o log.
  const requestId = c.get('requestId') ?? '-'
  logErrorEvent('unhandled_error', {
    requestId,
    method: c.req.method,
    path: c.req.path,
    userId: c.get('user')?.id ?? '-',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })

  return c.json({ message: 'Erro interno. Tente novamente.', requestId }, 500)
}
