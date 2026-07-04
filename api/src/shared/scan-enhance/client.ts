// Cliente do microservico scan-enhance (realce server-side do scan). BEST-
// EFFORT por contrato: qualquer falha (servico fora, timeout, resposta
// invalida) devolve null e o chamador segue com o PDF original — o realce
// nunca pode derrubar a ingestao. Desligado quando SCAN_ENHANCE_URL ausente.

import { env } from '../config/env'

// Teto generoso: paginas a ~1-2s em CPU x ate 15 paginas + rede.
const ENHANCE_TIMEOUT_MS = 120_000

export type ScanEnhanceResult = {
  bytes: Uint8Array<ArrayBuffer>
  // Metricas por pagina reportadas pelo servico (nitidez antes/depois) —
  // apenas para log/telemetria.
  metrics: unknown
}

export function isScanEnhanceEnabled(): boolean {
  return Boolean(env.scanEnhanceUrl)
}

export async function enhanceScanPdf(
  pdfBytes: Uint8Array,
): Promise<ScanEnhanceResult | null> {
  if (!env.scanEnhanceUrl) {
    return null
  }
  try {
    const response = await fetch(`${env.scanEnhanceUrl}/enhance`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      // Copia para um ArrayBuffer proprio: BodyInit nao aceita Uint8Array
      // sobre SharedArrayBuffer e um slice garante o tipo exato.
      body: pdfBytes.slice().buffer as ArrayBuffer,
      signal: AbortSignal.timeout(ENHANCE_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error('scan-enhance: resposta nao-OK (seguindo com o original)', {
        status: response.status,
      })
      return null
    }
    const enhanced = new Uint8Array(await response.arrayBuffer())
    // Sanidade minima: precisa continuar sendo um PDF nao-vazio.
    if (enhanced.length < 4 || enhanced[0] !== 0x25) {
      console.error('scan-enhance: corpo invalido (seguindo com o original)')
      return null
    }
    let metrics: unknown = null
    try {
      const header = response.headers.get('x-enhance-metrics')
      metrics = header ? JSON.parse(header) : null
    } catch {
      // metricas sao opcionais
    }
    return { bytes: enhanced, metrics }
  } catch (error) {
    console.error('scan-enhance: falha na chamada (seguindo com o original)', {
      error: String(error),
    })
    return null
  }
}
