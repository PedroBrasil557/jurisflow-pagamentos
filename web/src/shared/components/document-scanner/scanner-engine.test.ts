import { describe, expect, it } from 'vitest'
import {
  type CornerPoints,
  expandQuad,
  isPlausibleQuad,
  orderCorners,
} from './scanner-engine'

type Point = { x: number; y: number }

function quad(tl: Point, tr: Point, br: Point, bl: Point): CornerPoints {
  return {
    topLeftCorner: tl,
    topRightCorner: tr,
    bottomRightCorner: br,
    bottomLeftCorner: bl,
  }
}

const W = 100
const H = 100
const ML_OPTIONS = {
  minAreaRatio: 0.05,
  maxAreaRatio: 1,
  minSideRatio: 0.05,
}

describe('isPlausibleQuad', () => {
  // Documento centralizado ocupando ~64% do quadro (10..90).
  const normal = quad(
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  )
  const fullFrame = quad(
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  )

  it('aceita um quadrilatero normal com os defaults', () => {
    expect(isPlausibleQuad(normal, W, H)).toBe(true)
  })

  it('rejeita o frame inteiro com os defaults (limite superior 99.8%)', () => {
    expect(isPlausibleQuad(fullFrame, W, H)).toBe(false)
  })

  it('aceita o frame inteiro quando maxAreaRatio = 1 (caso DocAligner)', () => {
    expect(isPlausibleQuad(fullFrame, W, H, ML_OPTIONS)).toBe(true)
  })

  it('rejeita area minuscula mesmo com os limites do ML', () => {
    // 4x4 = 16 px (0.16% do quadro) < minAreaRatio 5%.
    const tiny = quad(
      { x: 48, y: 48 },
      { x: 52, y: 48 },
      { x: 52, y: 52 },
      { x: 48, y: 52 },
    )
    expect(isPlausibleQuad(tiny, W, H, ML_OPTIONS)).toBe(false)
  })

  it('rejeita quadrilatero degenerado (lado curto) pelo minSideRatio', () => {
    // 100 x 15: area 15% (passa a faixa default), mas lado curto 15 < 20 (=0.2*100).
    const sliver = quad(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 15 },
      { x: 0, y: 15 },
    )
    expect(isPlausibleQuad(sliver, W, H)).toBe(false)
  })
})

describe('expandQuad', () => {
  // Quad centralizado 20..80 (centroide 50,50), num frame 100x100.
  const centered = quad(
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  )

  it('devolve os cantos inalterados quando ratio <= 0', () => {
    expect(expandQuad(centered, W, H, 0)).toEqual(centered)
    expect(expandQuad(centered, W, H, -0.1)).toEqual(centered)
  })

  it('escala o quad em torno do centroide por (1 + ratio)', () => {
    // offset de cada canto ao centroide (50,50) = 30; com ratio 0.1 -> 33.
    const out = expandQuad(centered, W, H, 0.1)
    expect(out.topLeftCorner).toEqual({ x: 17, y: 17 })
    expect(out.topRightCorner).toEqual({ x: 83, y: 17 })
    expect(out.bottomRightCorner).toEqual({ x: 83, y: 83 })
    expect(out.bottomLeftCorner).toEqual({ x: 17, y: 83 })
  })

  it('preserva o centroide (folga simetrica)', () => {
    const out = expandQuad(centered, W, H, 0.2)
    const cx =
      (out.topLeftCorner.x +
        out.topRightCorner.x +
        out.bottomRightCorner.x +
        out.bottomLeftCorner.x) /
      4
    const cy =
      (out.topLeftCorner.y +
        out.topRightCorner.y +
        out.bottomRightCorner.y +
        out.bottomLeftCorner.y) /
      4
    expect(cx).toBeCloseTo(50)
    expect(cy).toBeCloseTo(50)
  })

  it('faz clamp aos limites da imagem (canto nao passa da borda)', () => {
    // Quad ja proximo da borda: expandir empurraria para fora; deve travar em 0..100.
    const nearEdge = quad(
      { x: 2, y: 2 },
      { x: 98, y: 2 },
      { x: 98, y: 98 },
      { x: 2, y: 98 },
    )
    const out = expandQuad(nearEdge, W, H, 0.2)
    for (const c of [
      out.topLeftCorner,
      out.topRightCorner,
      out.bottomRightCorner,
      out.bottomLeftCorner,
    ]) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThanOrEqual(W)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeLessThanOrEqual(H)
    }
  })
})

describe('orderCorners', () => {
  it('reordena 4 pontos quaisquer em TL, TR, BR, BL', () => {
    const tl = { x: 0, y: 0 }
    const tr = { x: 10, y: 0 }
    const br = { x: 10, y: 10 }
    const bl = { x: 0, y: 10 }
    // Entrada embaralhada (rotulos trocados de proposito).
    const scrambled = quad(br, bl, tl, tr)

    const ordered = orderCorners(scrambled)

    expect(ordered.topLeftCorner).toEqual(tl)
    expect(ordered.topRightCorner).toEqual(tr)
    expect(ordered.bottomRightCorner).toEqual(br)
    expect(ordered.bottomLeftCorner).toEqual(bl)
  })
})
