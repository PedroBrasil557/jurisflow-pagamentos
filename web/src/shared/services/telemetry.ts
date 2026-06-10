import { clientEnv } from '@/shared/config/client-env'

type NetworkInformation = { effectiveType?: string; downlink?: number }

// Envia um evento de erro do cliente para o servidor (best-effort, NUNCA quebra
// o fluxo). Usa sendBeacon para sobreviver a navegacao/unload. Captura, em
// especial, falhas de REDE que nunca chegam ao endpoint principal (ex.: "Failed
// to fetch"/ERR_FAILED no upload) — com contexto para diagnosticar a causa real.
export function reportClientError(
  event: string,
  detail: Record<string, unknown>,
): void {
  try {
    const connection = (
      navigator as Navigator & { connection?: NetworkInformation }
    ).connection

    const body = JSON.stringify({
      event,
      ...detail,
      url: window.location.href,
      online: navigator.onLine,
      effectiveType: connection?.effectiveType,
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
    })

    const endpoint = `${clientEnv.apiUrl}/api/telemetry/client-error`

    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        endpoint,
        new Blob([body], { type: 'application/json' }),
      )
    } else {
      void fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        keepalive: true,
      })
    }
  } catch {
    // Telemetria nunca pode interromper o fluxo do usuario.
  }
}
