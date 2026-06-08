import { APIError, createAuthMiddleware } from 'better-auth/api'
import {
  enrichEventGeo,
  recordLoginEvent,
} from '../auth-audit/auth-audit.service'

export const signUpValidationHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === '/sign-up/email') {
    const isInternalCall = ctx.request === undefined

    if (!isInternalCall) {
      throw new APIError('FORBIDDEN', {
        message: 'Cadastro publico desabilitado. Contate um administrador.',
      })
    }
  }
})

const SIGN_IN_PATHS = new Set(['/sign-in/email', '/sign-in/username'])

function extractIpFromHeaders(headers: Headers | undefined) {
  if (!headers) {
    return null
  }

  for (const key of ['x-forwarded-for', 'x-real-ip']) {
    const value = headers.get(key)
    if (value) {
      return value.split(',')[0]?.trim() ?? null
    }
  }

  return null
}

// Registra cada tentativa de login (sucesso e falha) na trilha de auditoria.
// Roda como hook "after"; better-auth captura APIErrors do handler e os expoe
// em ctx.context.returned, entao falhas tambem chegam aqui. Nunca lanca erro
// para nao interferir no fluxo de autenticacao.
export const loginAuditHook = createAuthMiddleware(async (ctx) => {
  if (!SIGN_IN_PATHS.has(ctx.path)) {
    return
  }

  try {
    const userAgent = ctx.headers?.get('user-agent') ?? null
    const newSession = ctx.context.newSession
    const body = (ctx.body ?? {}) as {
      email?: string
      username?: string
    }
    const identifier = body.email ?? body.username ?? ''

    if (newSession) {
      const ipAddress =
        newSession.session.ipAddress || extractIpFromHeaders(ctx.headers)
      const eventId = await recordLoginEvent({
        userId: newSession.user.id,
        identifier: identifier || newSession.user.email,
        userName: newSession.user.name,
        status: 'success',
        failureReason: null,
        ipAddress,
        userAgent,
      })

      // Enriquecimento de geo nao bloqueante.
      void enrichEventGeo(eventId, ipAddress)
      return
    }

    const returned = ctx.context.returned
    if (returned instanceof APIError) {
      const ipAddress = extractIpFromHeaders(ctx.headers)
      const eventId = await recordLoginEvent({
        userId: null,
        identifier,
        userName: null,
        status: 'failure',
        failureReason: returned.body?.code ?? returned.message ?? 'UNKNOWN',
        ipAddress,
        userAgent,
      })

      void enrichEventGeo(eventId, ipAddress)
    }
  } catch {
    // Auditoria nunca deve quebrar o login.
  }
})
