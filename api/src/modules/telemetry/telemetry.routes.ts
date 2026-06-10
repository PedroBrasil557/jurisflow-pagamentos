import { Hono } from 'hono'
import { logEvent } from '../../shared/observability/log'
import type { AppBindings } from '../../shared/types/app'

// Teto do payload do cliente que vai para o log (evita logs gigantes).
const MAX_PAYLOAD_CHARS = 8_000

// Recebe eventos de erro do cliente (via navigator.sendBeacon). Captura falhas
// que NUNCA chegam ao endpoint principal (ex.: "Failed to fetch" no upload) —
// registrando o contexto do cliente correlacionado por requestId/usuario.
// Sem auth obrigatoria: a telemetria deve gravar mesmo se a sessao estiver ruim.
export const telemetryRoutes = new Hono<AppBindings>().post(
  '/client-error',
  async (c) => {
    let payload: string | null = null
    try {
      const body = await c.req.json()
      payload = JSON.stringify(body).slice(0, MAX_PAYLOAD_CHARS)
    } catch {
      payload = null
    }

    logEvent('client_error', {
      requestId: c.get('requestId'),
      userId: c.get('user')?.id ?? '-',
      payload,
    })

    return c.body(null, 204)
  },
)
