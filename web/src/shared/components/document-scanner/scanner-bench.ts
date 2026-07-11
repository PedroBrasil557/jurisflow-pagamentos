// Nucleo do harness offline de avaliacao do scanner. Dado o quad CRU detectado
// pelo DocAligner numa fixture (capturado UMA vez rodando o detector real) e o
// quad VERDADEIRO rotulado a mao, aplica cada preset de tuning e pontua o
// recorte resultante: IoU vs. verdade + se a faixa de conteudo (assinatura)
// ficou dentro do recorte. Assim se identifica, sem risco em prod, qual
// config performou melhor. Funcoes puras (sem DOM/ONNX) — usadas pelo CLI
// (scripts/scanner-bench.ts) e pelos testes.
//
// O eixo margem/fallback/revisao e varrido sobre um MESMO detections.json (o
// quad cru nao muda). Para comparar MODELO ou letterbox (que mudam a deteccao),
// capture um detections.json por variante e rode o bench para cada um.

import {
  type CornerPoints,
  isRiskyDetection,
  resolveFinalCorners,
} from './scanner-engine'
import {
  SCANNER_TUNING_PRESETS,
  type ScannerTuning,
  type ScannerTuningVersion,
} from './scanner-tuning'

type Point = { x: number; y: number }

export type BBox = { x: number; y: number; width: number; height: number }

// Fixture rotulada a mao (uma vez): dimensoes + quad verdadeiro + regiao de
// conteudo critico (assinatura/rubrica) que o recorte NAO pode cortar.
export type BenchFixture = {
  id: string
  width: number
  height: number
  trueCorners: CornerPoints
  contentBBox: BBox
}

// Saida CRUA do DocAligner na fixture. null = a deteccao falhou (cai no fallback).
export type BenchDetection = {
  id: string
  rawQuad: CornerPoints | null
}

export type FixtureScore = {
  id: string
  iou: number
  // true = a bbox de conteudo esta INTEIRA dentro do recorte (nao cortou).
  contentCovered: boolean
  // true = o tuning pediria revisao manual (deteccao arriscada).
  flaggedForReview: boolean
  detected: boolean
}

export type PresetReport = {
  version: string
  meanIoU: number
  // % de fixtures cujo conteudo critico foi CORTADO (menor = melhor).
  pctContentClipped: number
  // % de fixtures que cairiam no fallback (deteccao nula).
  pctFallback: number
  // % de fixtures marcadas para revisao manual.
  pctFlaggedForReview: number
  n: number
}

function toPolygon(c: CornerPoints): Point[] {
  return [
    c.topLeftCorner,
    c.topRightCorner,
    c.bottomRightCorner,
    c.bottomLeftCorner,
  ]
}

function signedArea(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function polygonArea(poly: Point[]): number {
  return Math.abs(signedArea(poly))
}

// Garante orientacao anti-horaria (area assinada > 0) para os testes de lado.
function ensureCcw(poly: Point[]): Point[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly
}

// Recorte de Sutherland-Hodgman: interseccao de `subject` pelo poligono CONVEXO
// `clip` (ambos os quads sao convexos apos orderCorners). Devolve o poligono de
// interseccao (vazio se nao ha sobreposicao).
function clipPolygon(subject: Point[], clipInput: Point[]): Point[] {
  const clip = ensureCcw(clipInput)
  let output = ensureCcw(subject)
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    const input = output
    output = []
    // Dentro = lado esquerdo da aresta a->b (cross >= 0 em orientacao CCW).
    const inside = (p: Point) =>
      (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0
    // Interseccao do segmento p->q com a reta infinita por a,b.
    const intersect = (p: Point, q: Point): Point => {
      const rx = q.x - p.x
      const ry = q.y - p.y
      const sx = b.x - a.x
      const sy = b.y - a.y
      const denom = rx * sy - ry * sx
      const t = denom === 0 ? 0 : ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom
      return { x: p.x + t * rx, y: p.y + t * ry }
    }
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]
      const prev = input[(j + input.length - 1) % input.length]
      const curIn = inside(cur)
      const prevIn = inside(prev)
      if (curIn) {
        if (!prevIn) {
          output.push(intersect(prev, cur))
        }
        output.push(cur)
      } else if (prevIn) {
        output.push(intersect(prev, cur))
      }
    }
    if (output.length === 0) {
      return []
    }
  }
  return output
}

// IoU (Intersection over Union) de dois quadrilateros convexos.
export function quadIoU(a: CornerPoints, b: CornerPoints): number {
  const pa = toPolygon(a)
  const pb = toPolygon(b)
  const inter = polygonArea(clipPolygon(pa, pb))
  const union = polygonArea(pa) + polygonArea(pb) - inter
  return union <= 0 ? 0 : inter / union
}

function pointInConvex(p: Point, poly: Point[]): boolean {
  const ccw = ensureCcw(poly)
  for (let i = 0; i < ccw.length; i++) {
    const a = ccw[i]
    const b = ccw[(i + 1) % ccw.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross < -1e-6) {
      return false
    }
  }
  return true
}

// A bbox de conteudo esta INTEIRA dentro do quad? (os 4 cantos da bbox dentro).
export function bboxCoveredByQuad(bbox: BBox, quad: CornerPoints): boolean {
  const poly = toPolygon(quad)
  const corners: Point[] = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ]
  return corners.every((c) => pointInConvex(c, poly))
}

export function scoreFixture(
  fixture: BenchFixture,
  detection: BenchDetection,
  tuning: ScannerTuning,
): FixtureScore {
  const final = resolveFinalCorners(
    detection.rawQuad,
    fixture.width,
    fixture.height,
    { marginRatio: tuning.marginRatio, fallbackMode: tuning.fallbackMode },
  )
  const flaggedForReview =
    tuning.riskReview.enabled &&
    (tuning.riskReview.always ||
      isRiskyDetection(detection.rawQuad, fixture.width, fixture.height, {
        edgeMarginPct: tuning.riskReview.edgeMarginPct,
        minAreaRatio: tuning.riskReview.minAreaRatio,
      }))
  return {
    id: fixture.id,
    iou: quadIoU(final, fixture.trueCorners),
    contentCovered: bboxCoveredByQuad(fixture.contentBBox, final),
    flaggedForReview,
    detected: detection.rawQuad !== null,
  }
}

export function runPreset(
  version: string,
  tuning: ScannerTuning,
  fixtures: BenchFixture[],
  detections: Map<string, BenchDetection>,
): PresetReport {
  const scores = fixtures.map((f) =>
    scoreFixture(
      f,
      detections.get(f.id) ?? { id: f.id, rawQuad: null },
      tuning,
    ),
  )
  const n = scores.length
  const denom = n || 1
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  return {
    version,
    meanIoU: sum(scores.map((s) => s.iou)) / denom,
    pctContentClipped:
      (100 * scores.filter((s) => !s.contentCovered).length) / denom,
    pctFallback: (100 * scores.filter((s) => !s.detected).length) / denom,
    pctFlaggedForReview:
      (100 * scores.filter((s) => s.flaggedForReview).length) / denom,
    n,
  }
}

// Varre TODOS os presets sobre um conjunto de detections. Ver nota do topo sobre
// os eixos modelo/letterbox (precisam de um detections.json por variante).
export function runAllPresets(
  fixtures: BenchFixture[],
  detections: BenchDetection[],
): PresetReport[] {
  const map = new Map(detections.map((d) => [d.id, d]))
  const versions = Object.keys(SCANNER_TUNING_PRESETS) as ScannerTuningVersion[]
  return versions.map((v) =>
    runPreset(v, SCANNER_TUNING_PRESETS[v], fixtures, map),
  )
}
