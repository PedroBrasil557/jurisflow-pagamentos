import type { Context, Next } from 'hono'
import type { AppBindings } from '../types/app'

export function requestLogger() {
  return async (c: Context<AppBindings>, next: Next) => {
    const start = performance.now()
    const method = c.req.method
    const path = c.req.path

    await next()

    const duration = Math.round(performance.now() - start)
    const status = c.res.status
    const userId = c.get('user')?.id ?? '-'

    console.log(`${method} ${path} ${status} ${duration}ms user=${userId}`)
  }
}
