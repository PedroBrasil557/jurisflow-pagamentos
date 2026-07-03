import { describe, expect, it } from 'vitest'
import { laplacianVariance, toLuminance } from './sharpness'

function flat(width: number, height: number, value: number): Float32Array {
  return new Float32Array(width * height).fill(value)
}

// Xadrez 1px: transicao maxima em toda parte — o teto pratico de nitidez.
function checkerboard(width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gray[y * width + x] = (x + y) % 2 === 0 ? 0 : 255
    }
  }
  return gray
}

// Rampa horizontal suave: gradiente sem bordas (Laplaciano ~0), como uma foto
// completamente desfocada.
function ramp(width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gray[y * width + x] = (255 * x) / (width - 1)
    }
  }
  return gray
}

describe('laplacianVariance', () => {
  it('imagem plana tem variancia zero', () => {
    expect(laplacianVariance(flat(32, 32, 128), 32, 32)).toBe(0)
  })

  it('rampa suave (sem bordas) tem variancia ~zero', () => {
    expect(laplacianVariance(ramp(64, 32), 64, 32)).toBeLessThan(1)
  })

  it('xadrez (bordas maximas) tem variancia alta', () => {
    expect(laplacianVariance(checkerboard(32, 32), 32, 32)).toBeGreaterThan(
      10_000,
    )
  })

  it('texto nitido pontua acima de texto borrado', () => {
    const width = 64
    const height = 64
    // "Texto" nitido: listras verticais duras a cada 4px.
    const sharp = new Float32Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        sharp[y * width + x] = x % 4 < 2 ? 0 : 255
      }
    }
    // O mesmo padrao "borrado": media movel de 3px na horizontal.
    const blurred = new Float32Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = sharp[y * width + Math.max(0, x - 1)]
        const b = sharp[y * width + x]
        const c = sharp[y * width + Math.min(width - 1, x + 1)]
        blurred[y * width + x] = (a + b + c) / 3
      }
    }
    const sharpScore = laplacianVariance(sharp, width, height)
    const blurredScore = laplacianVariance(blurred, width, height)
    expect(sharpScore).toBeGreaterThan(blurredScore * 1.5)
  })

  it('imagem menor que 3x3 retorna zero', () => {
    expect(laplacianVariance(flat(2, 2, 100), 2, 2)).toBe(0)
  })
})

describe('toLuminance', () => {
  it('converte RGBA em luminancia Rec. 601', () => {
    // Um pixel branco e um preto.
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const gray = toLuminance(data)
    expect(gray.length).toBe(2)
    expect(gray[0]).toBeCloseTo(255, 0)
    expect(gray[1]).toBe(0)
  })
})
