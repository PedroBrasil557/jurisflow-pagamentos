import type { Context, Next } from 'hono'
import type { AppBindings } from '../types/app'

// Correlation ID por request: adota o x-request-id recebido (se um proxy ja
// gerou), ou o trace do API Gateway (x-amzn-trace-id), ou gera um. Fica em
// c.get('requestId') para todos os logs e e devolvido no header x-request-id da
// resposta — o cliente captura para correlacionar uma falha com o log do server.
export function requestId() {
  return async (c: Context<AppBindings>, next: Next) => {
    const incoming =
      c.req.header('x-request-id') ||
      c.req.header('x-amzn-trace-id') ||
      crypto.randomUUID()

    c.set('requestId', incoming)
    c.header('x-request-id', incoming)

    await next()
  }
}
