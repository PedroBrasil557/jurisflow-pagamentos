import type { Context, Next } from 'hono'
import type { AppBindings } from '../../shared/types/app'
import { resolveUserPermissions } from './permissions.service'
import type { ProfilePermissions } from './permissions.types'

// Guard por FLAG de permissao de perfil (grupos alem de process/sections, ex.:
// titularCaixa, cadastros). Sem bypass de admin comum: as flags ja chegam
// resolvidas (master = tudo true; admin comum = do perfil atribuido).
export function requirePermission<Group extends keyof ProfilePermissions>(
  group: Group,
  action: keyof ProfilePermissions[Group],
) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user')
    if (!user) {
      return c.json({ message: 'Sessao invalida.' }, 401)
    }
    const perms = await resolveUserPermissions(user.id, user.role)
    const groupFlags = perms.permissions[group] as Record<string, boolean>
    if (!groupFlags[action as string]) {
      return c.json(
        { message: 'Voce nao tem permissao para acessar este recurso.' },
        403,
      )
    }
    await next()
  }
}
