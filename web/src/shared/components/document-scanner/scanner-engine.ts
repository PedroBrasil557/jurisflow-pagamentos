// Geometria pura dos 4 cantos do documento — SEM dependencia de OpenCV. A deteccao
// e feita pela IA (DocAligner, ver `docaligner/`) e o recorte por perspectiva pelo
// warp WebGL (ver `scan-warp.ts`). Este modulo so guarda os tipos e as funcoes de
// ordenacao/validacao dos cantos, compartilhadas por esses consumidores.

export type Corner = { x: number; y: number }

export type CornerPoints = {
  topLeftCorner: Corner
  topRightCorner: Corner
  bottomLeftCorner: Corner
  bottomRightCorner: Corner
}

export type ImageSource = HTMLCanvasElement | HTMLImageElement

// Contrato do detector de cantos. O DocAligner (IA) implementa isto; o
// WebScannerDialog o injeta. Assincrono porque a inferencia ONNX retorna Promise.
// Devolve os 4 cantos ja ordenados/validados, ou null se nada confiavel.
export type DetectOptions = { fallback?: boolean }
export interface CornerDetector {
  detect(
    source: ImageSource,
    options?: DetectOptions,
  ): Promise<CornerPoints | null>
}

function distance(a: Corner, b: Corner): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Area do quadrilatero (formula de Gauss/shoelace) na ordem TL -> TR -> BR -> BL.
function quadArea(corners: CornerPoints): number {
  const points = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]

  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }

  return Math.abs(area) / 2
}

// Reordena 4 pontos quaisquer em TL, TR, BR, BL de forma robusta: o canto
// superior-esquerdo tem a menor soma (x+y) e o inferior-direito a maior; o
// superior-direito tem o menor (y-x) e o inferior-esquerdo o maior.
export function orderCorners(corners: CornerPoints): CornerPoints {
  const points = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y))
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x))

  return {
    topLeftCorner: bySum[0],
    bottomRightCorner: bySum[3],
    topRightCorner: byDiff[0],
    bottomLeftCorner: byDiff[3],
  }
}

// Limiares geometricos da validacao de quadrilatero. O detector DocAligner (IA)
// sobrescreve com limites mais frouxos: confia nos cantos do modelo e permite o
// documento preencher o quadro (maxAreaRatio: 1), mantendo so um piso
// anti-degenerescencia.
export type PlausibleQuadOptions = {
  minAreaRatio?: number
  maxAreaRatio?: number
  minSideRatio?: number
}

// Descarta deteccoes improvaveis: contorno minusculo (ruido), o frame inteiro
// (sem documento real) ou lados degenerados — nesses casos e melhor usar os
// cantos padrao do que aplicar um recorte/perspectiva torto.
export function isPlausibleQuad(
  corners: CornerPoints,
  width: number,
  height: number,
  options: PlausibleQuadOptions = {},
): boolean {
  const {
    minAreaRatio = 0.12,
    maxAreaRatio = 0.998,
    minSideRatio = 0.2,
  } = options
  const imageArea = width * height
  const area = quadArea(corners)

  if (area < imageArea * minAreaRatio || area > imageArea * maxAreaRatio) {
    return false
  }

  const sides = [
    distance(corners.topLeftCorner, corners.topRightCorner),
    distance(corners.topRightCorner, corners.bottomRightCorner),
    distance(corners.bottomRightCorner, corners.bottomLeftCorner),
    distance(corners.bottomLeftCorner, corners.topLeftCorner),
  ]

  return Math.min(...sides) >= Math.min(width, height) * minSideRatio
}

// Escala o quad em torno do seu centroide por (1 + ratio), com clamp aos limites
// da imagem — uma folga (outset) pequena e uniforme. As assinaturas/rubricas
// moram nos ~8-10% externos da pagina; a folga garante que uma deteccao
// levemente para dentro ainda as inclua, ao custo de uma tira fina de fundo.
// ratio <= 0 devolve os cantos inalterados. Os cantos podem chegar ao clamp
// (borda da imagem) sem quebrar — o warp lida com quad na borda.
export function expandQuad(
  corners: CornerPoints,
  width: number,
  height: number,
  ratio: number,
): CornerPoints {
  if (ratio <= 0) {
    return corners
  }
  const keys = [
    'topLeftCorner',
    'topRightCorner',
    'bottomRightCorner',
    'bottomLeftCorner',
  ] as const
  const cx =
    (corners.topLeftCorner.x +
      corners.topRightCorner.x +
      corners.bottomRightCorner.x +
      corners.bottomLeftCorner.x) /
    4
  const cy =
    (corners.topLeftCorner.y +
      corners.topRightCorner.y +
      corners.bottomRightCorner.y +
      corners.bottomLeftCorner.y) /
    4
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  const out = {} as CornerPoints
  for (const key of keys) {
    const c = corners[key]
    out[key] = {
      x: clamp(cx + (c.x - cx) * (1 + ratio), width),
      y: clamp(cy + (c.y - cy) * (1 + ratio), height),
    }
  }
  return out
}

export type RiskOptions = { edgeMarginPct: number; minAreaRatio: number }

// Avalia se a deteccao e "arriscada" o bastante para pedir revisao manual dos
// cantos ANTES de gravar a pagina (converte perda silenciosa em correcao
// visivel). Arriscado quando: sem deteccao (caiu no fallback), quad pequeno
// demais (mis-deteccao) ou com algum canto colado na borda (o documento
// provavelmente sangra alem do quadro e foi cortado). Avaliar sobre o quad CRU
// (antes da folga do expandQuad), senao a folga inflaria o sinal de borda.
export function isRiskyDetection(
  detected: CornerPoints | null,
  width: number,
  height: number,
  { edgeMarginPct, minAreaRatio }: RiskOptions,
): boolean {
  if (!detected) {
    return true
  }
  if (quadArea(detected) < width * height * minAreaRatio) {
    return true
  }
  const marginX = width * edgeMarginPct
  const marginY = height * edgeMarginPct
  const corners = [
    detected.topLeftCorner,
    detected.topRightCorner,
    detected.bottomRightCorner,
    detected.bottomLeftCorner,
  ]
  return corners.some(
    (c) =>
      c.x <= marginX ||
      c.x >= width - marginX ||
      c.y <= marginY ||
      c.y >= height - marginY,
  )
}

// Cantos do quadro inteiro (recorte identidade — nao descarta nada). Fallback
// que nunca corta conteudo: no pior caso sobra fundo, recuperavel na edicao.
export function fullFrameCorners(width: number, height: number): CornerPoints {
  return {
    topLeftCorner: { x: 0, y: 0 },
    topRightCorner: { x: width, y: 0 },
    bottomRightCorner: { x: width, y: height },
    bottomLeftCorner: { x: 0, y: height },
  }
}

// Cantos recuados por `ratio` em cada lado (ex.: 0.08 = recuo de 8%). Fallback
// legado — corta a faixa externa (assinaturas); mantido so para o preset base.
export function insetCorners(
  width: number,
  height: number,
  ratio: number,
): CornerPoints {
  const insetX = width * ratio
  const insetY = height * ratio
  return {
    topLeftCorner: { x: insetX, y: insetY },
    topRightCorner: { x: width - insetX, y: insetY },
    bottomRightCorner: { x: width - insetX, y: height - insetY },
    bottomLeftCorner: { x: insetX, y: height - insetY },
  }
}

export type FallbackMode = 'full-frame' | 'inset-8'

// Quad final a partir do quad CRU detectado + tuning: com deteccao, aplica a
// folga (outset) para nao cortar a faixa externa; sem deteccao, usa o quadro
// inteiro ou o recuo legado de 8%. Mesma logica na captura (WebScannerDialog) e
// no harness offline (scanner-bench) — fonte unica.
export function resolveFinalCorners(
  rawQuad: CornerPoints | null,
  width: number,
  height: number,
  {
    marginRatio,
    fallbackMode,
  }: { marginRatio: number; fallbackMode: FallbackMode },
): CornerPoints {
  if (rawQuad) {
    return expandQuad(rawQuad, width, height, marginRatio)
  }
  return fallbackMode === 'full-frame'
    ? fullFrameCorners(width, height)
    : insetCorners(width, height, 0.08)
}
