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
