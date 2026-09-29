import type { MiddlewareHandler } from 'hono'
import { auth } from '../../modules/auth/auth.service'
import type { AppBindings } from '../types/app'

const PUBLIC_SYSTEM_HEALTH_PATHS = new Set([
  '/api/system/health',
  '/api/system/health/db',
])

const BETTER_AUTH_PATH_PREFIX = '/api/auth/'

export const sessionMiddleware: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  // Health checks precisam funcionar sem depender de sessao. Isso permite
  // distinguir falha de runtime da API de indisponibilidade do banco/auth.
  // As rotas /api/auth/* pertencem ao Better Auth e fazem a propria validacao
  // de sessao/CSRF/origin. Nao devemos chamar getSession antes do handler de
  // login, logout ou troca de senha, pois isso altera o fluxo de autenticacao.
  if (
    PUBLIC_SYSTEM_HEALTH_PATHS.has(c.req.path) ||
    c.req.path.startsWith(BETTER_AUTH_PATH_PREFIX)
  ) {
    c.set('user', null)
    c.set('session', null)
    await next()
    return
  }

  const currentSession = await auth.api.getSession({
    headers: c.req.raw.headers,
  })

  // Revogacao de acesso: usuario desativado (isActive=false) e tratado como nao
  // autenticado em TODA requisicao — derruba o acesso na hora (nao so no proximo
  // login), inclusive para sessoes ja existentes. Sem isto, desativar um usuario
  // (offboarding/LGPD/conta comprometida) nao tem efeito de seguranca.
  const sessionUser =
    currentSession?.user && currentSession.user.isActive !== false
      ? currentSession.user
      : null

  c.set('user', sessionUser)
  c.set('session', sessionUser ? (currentSession?.session ?? null) : null)

  await next()
}
