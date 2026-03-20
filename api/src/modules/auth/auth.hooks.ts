import { APIError, createAuthMiddleware } from 'better-auth/api'

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
