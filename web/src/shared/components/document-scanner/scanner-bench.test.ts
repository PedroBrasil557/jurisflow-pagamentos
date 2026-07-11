import { describe, expect, it } from 'vitest'
import {
  type BenchDetection,
  type BenchFixture,
  bboxCoveredByQuad,
  quadIoU,
  runPreset,
  scoreFixture,
} from './scanner-bench'
import type { CornerPoints } from './scanner-engine'
import { SCANNER_TUNING_PRESETS } from './scanner-tuning'

function rect(x0: number, y0: number, x1: number, y1: number): CornerPoints {
  return {
    topLeftCorner: { x: x0, y: y0 },
    topRightCorner: { x: x1, y: y0 },
    bottomRightCorner: { x: x1, y: y1 },
    bottomLeftCorner: { x: x0, y: y1 },
  }
}

describe('quadIoU', () => {
  it('e 1 para quads identicos', () => {
    const q = rect(0, 0, 100, 100)
    expect(quadIoU(q, q)).toBeCloseTo(1)
  })

  it('e 0 para quads disjuntos', () => {
    expect(quadIoU(rect(0, 0, 10, 10), rect(50, 50, 60, 60))).toBeCloseTo(0)
  })

  it('calcula sobreposicao parcial (interseccao/uniao)', () => {
    // A=[0..100]^2 (10000), B=[50..150]^2 (10000). Inter=[50..100]^2=2500.
    // Uniao = 10000 + 10000 - 2500 = 17500. IoU = 2500/17500 = 1/7.
    const iou = quadIoU(rect(0, 0, 100, 100), rect(50, 50, 150, 150))
    expect(iou).toBeCloseTo(2500 / 17500)
  })
})

describe('bboxCoveredByQuad', () => {
  const quad = rect(0, 0, 100, 100)

  it('true quando a bbox esta inteira dentro', () => {
    expect(
      bboxCoveredByQuad({ x: 10, y: 10, width: 20, height: 20 }, quad),
    ).toBe(true)
  })

  it('false quando a bbox sai do quad', () => {
    expect(
      bboxCoveredByQuad({ x: 90, y: 90, width: 20, height: 20 }, quad),
    ).toBe(false)
  })
})

describe('scoreFixture — fallback full-frame recupera assinatura', () => {
  // Deteccao falha (rawQuad null); a assinatura mora nos 8% de baixo — dentro do
  // recuo legado, fora do frame inteiro so se cortado.
  const fixture: BenchFixture = {
    id: 'f1',
    width: 100,
    height: 100,
    trueCorners: rect(0, 0, 100, 100),
    // bbox no canto inferior esquerdo, dentro da faixa externa de 8%.
    contentBBox: { x: 2, y: 93, width: 5, height: 5 },
  }
  const detection: BenchDetection = { id: 'f1', rawQuad: null }

  it('v1-baseline (inset-8) CORTA a assinatura', () => {
    const score = scoreFixture(
      fixture,
      detection,
      SCANNER_TUNING_PRESETS['v1-baseline'],
    )
    expect(score.detected).toBe(false)
    expect(score.contentCovered).toBe(false)
  })

  it('v2-margin3-fullframe (full-frame) MANTEM a assinatura e marca revisao', () => {
    const score = scoreFixture(
      fixture,
      detection,
      SCANNER_TUNING_PRESETS['v2-margin3-fullframe'],
    )
    expect(score.contentCovered).toBe(true)
    // deteccao nula -> arriscado -> revisao pedida.
    expect(score.flaggedForReview).toBe(true)
  })
})

describe('runPreset — agregacao', () => {
  const fixtures: BenchFixture[] = [
    {
      id: 'a',
      width: 100,
      height: 100,
      trueCorners: rect(0, 0, 100, 100),
      contentBBox: { x: 2, y: 93, width: 5, height: 5 },
    },
  ]
  const detections: BenchDetection[] = [{ id: 'a', rawQuad: null }]

  it('conta fallback e conteudo cortado por preset', () => {
    const map = new Map(detections.map((d) => [d.id, d]))
    const baseline = runPreset(
      'v1-baseline',
      SCANNER_TUNING_PRESETS['v1-baseline'],
      fixtures,
      map,
    )
    expect(baseline.pctFallback).toBe(100)
    expect(baseline.pctContentClipped).toBe(100)

    const v2 = runPreset(
      'v2-margin3-fullframe',
      SCANNER_TUNING_PRESETS['v2-margin3-fullframe'],
      fixtures,
      map,
    )
    expect(v2.pctFallback).toBe(100)
    expect(v2.pctContentClipped).toBe(0)
    expect(v2.pctFlaggedForReview).toBe(100)
  })
})
