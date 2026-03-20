import type { MiddlewareHandler } from 'hono'
import { auth } from '../../modules/auth/auth.service'
import type { AppBindings } from '../types/app'

export const sessionMiddleware: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  const currentSession = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  c.set('user', currentSession?.user ?? null)
  c.set('session', currentSession?.session ?? null)

  await next()
}
