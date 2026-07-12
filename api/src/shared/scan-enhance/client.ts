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

// Chamada OBRIGATORIA ao microservico (contrario do enhanceScanPdf best-effort):
// LANCA em qualquer falha. Os chamadores rodam isto ANTES de gravar/anexar,
// entao a falha aborta limpo (fila re-executa; backfill pula o arquivo).
async function callScanEnhanceRequired(
  url: string,
  pdfBytes: Uint8Array,
): Promise<ScanEnhanceResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: pdfBytes.slice().buffer as ArrayBuffer,
    signal: AbortSignal.timeout(ENHANCE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`scan-enhance ${url} respondeu ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  // Precisa continuar sendo um PDF nao-vazio.
  if (bytes.length < 4 || bytes[0] !== 0x25) {
    throw new Error('scan-enhance: corpo de resposta invalido')
  }
  let metrics: unknown = null
  try {
    const header = response.headers.get('x-enhance-metrics')
    metrics = header ? JSON.parse(header) : null
  } catch {
    // metricas sao opcionais
  }
  return { bytes, metrics }
}

// Realce + encode-para-caber (<= maxBytes) por documento, para o anexo do
// checklist (fluxo de scan NOVO). Servico desligado (SCAN_ENHANCE_URL ausente)
// => null (o chamador anexa o original sem fit; dev/opt-out). Configurado mas
// falha => LANCA (o chamador roda antes de anexar => a fila re-executa limpo).
// E assim que "<= limite" vira invariante da ingestao em producao.
export async function enhanceFitPdf(
  pdfBytes: Uint8Array,
  maxBytes: number,
): Promise<ScanEnhanceResult | null> {
  if (!env.scanEnhanceUrl) {
    return null
  }
  return callScanEnhanceRequired(
    `${env.scanEnhanceUrl}/enhance?max_bytes=${maxBytes}`,
    pdfBytes,
  )
}

// SO reduz-para-caber (<= maxBytes), SEM realce. Para o BACKFILL de arquivos ja
// anexados: um scan legado ja foi realcado (re-realcar super-processaria) e um
// PDF nato-digital nao deve ser realcado. Mesma semantica de erro do
// enhanceFitPdf (null se desligado, LANCA em falha).
export async function fitPdf(
  pdfBytes: Uint8Array,
  maxBytes: number,
): Promise<ScanEnhanceResult | null> {
  if (!env.scanEnhanceUrl) {
    return null
  }
  return callScanEnhanceRequired(
    `${env.scanEnhanceUrl}/fit?max_bytes=${maxBytes}`,
    pdfBytes,
  )
}
