import type { Context, Next } from 'hono'
import { ServiceError } from '../errors/service-error'
import type { AppBindings } from '../types/app'

export function requireAuth() {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ message: 'Sessao invalida.' }, 401)
    }

    await next()
  }
}

export function requireRole(...roles: string[]) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ message: 'Sessao invalida.' }, 401)
    }

    if (!roles.includes(user.role)) {
      return c.json(
        { message: 'Voce nao tem permissao para acessar este recurso.' },
        403,
      )
    }

    await next()
  }
}

export function getAuthenticatedUser(c: Context<AppBindings>) {
  const user = c.get('user')

  if (!user) {
    throw new ServiceError(401, 'Sessao invalida.')
  }

  return user
}
