import { describe, expect, it } from 'vitest'
import { postprocessHeatmap } from './postprocess'

// Monta um heatmap (4 canais x H x W) com um pixel "quente" (1.0) por canal,
// na ordem de canais TL, TR, BR, BL. `null` deixa o canal todo zerado.
function makeHeatmap(
  height: number,
  width: number,
  blobs: Array<[number, number] | null>,
): Float32Array {
  const plane = height * width
  const data = new Float32Array(4 * plane)
  blobs.forEach((blob, channel) => {
    if (blob) {
      const [x, y] = blob
      data[channel * plane + y * width + x] = 1
    }
  })
  return data
}

describe('postprocessHeatmap', () => {
  it('converte os 4 picos em cantos mapeados para o espaco da fonte', () => {
    // Heatmap 4x4; fonte 80x80 => fator 20 por celula.
    const heatmap = makeHeatmap(4, 4, [
      [1, 1], // TL
      [2, 1], // TR
      [2, 2], // BR
      [1, 2], // BL
    ])

    const corners = postprocessHeatmap(heatmap, 4, 4, 80, 80)

    expect(corners).not.toBeNull()
    expect(corners?.topLeftCorner.x).toBeCloseTo(20)
    expect(corners?.topLeftCorner.y).toBeCloseTo(20)
    expect(corners?.topRightCorner.x).toBeCloseTo(40)
    expect(corners?.topRightCorner.y).toBeCloseTo(20)
    expect(corners?.bottomRightCorner.x).toBeCloseTo(40)
    expect(corners?.bottomRightCorner.y).toBeCloseTo(40)
    expect(corners?.bottomLeftCorner.x).toBeCloseTo(20)
    expect(corners?.bottomLeftCorner.y).toBeCloseTo(40)
  })

  it('retorna null quando algum canto nao tem heatmap (canal zerado)', () => {
    const heatmap = makeHeatmap(4, 4, [
      [1, 1],
      [2, 1],
      [2, 2],
      null, // BL ausente
    ])

    expect(postprocessHeatmap(heatmap, 4, 4, 80, 80)).toBeNull()
  })

  it('usa o centroide do maior blob (ignora pixels isolados fracos)', () => {
    // Canal TL com um bloco 2x2 em (0..1, 0..1): centroide (0.5, 0.5).
    const height = 4
    const width = 4
    const plane = height * width
    const data = new Float32Array(4 * plane)
    const setPixel = (c: number, x: number, y: number, v: number) => {
      data[c * plane + y * width + x] = v
    }
    // TL: bloco 2x2 quente.
    setPixel(0, 0, 0, 1)
    setPixel(0, 1, 0, 1)
    setPixel(0, 0, 1, 1)
    setPixel(0, 1, 1, 1)
    // Demais cantos: 1 pixel cada.
    setPixel(1, 3, 0, 1)
    setPixel(2, 3, 3, 1)
    setPixel(3, 0, 3, 1)

    const corners = postprocessHeatmap(data, height, width, 80, 80)

    // Centroide (0.5, 0.5) em 4 celulas -> (0.5/4*80) = 10.
    expect(corners?.topLeftCorner.x).toBeCloseTo(10)
    expect(corners?.topLeftCorner.y).toBeCloseTo(10)
  })
})
