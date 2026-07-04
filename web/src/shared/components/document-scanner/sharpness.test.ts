import { describe, expect, it } from 'vitest'
import {
  BLUR_WARN_THRESHOLD,
  deriveQualityWarnings,
  illuminationRatios,
  laplacianVariance,
  tenengradScore,
  toLuminance,
} from './sharpness'

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

// Listras verticais duras ("texto" nitido) e a versao borrada (media movel 3px).
function stripes(
  width: number,
  height: number,
): {
  sharp: Float32Array
  blurred: Float32Array
} {
  const sharp = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sharp[y * width + x] = x % 4 < 2 ? 0 : 255
    }
  }
  const blurred = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = sharp[y * width + Math.max(0, x - 1)]
      const b = sharp[y * width + x]
      const c = sharp[y * width + Math.min(width - 1, x + 1)]
      blurred[y * width + x] = (a + b + c) / 3
    }
  }
  return { sharp, blurred }
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
    const { sharp, blurred } = stripes(64, 64)
    const sharpScore = laplacianVariance(sharp, 64, 64)
    const blurredScore = laplacianVariance(blurred, 64, 64)
    expect(sharpScore).toBeGreaterThan(blurredScore * 1.5)
  })

  it('imagem menor que 3x3 retorna zero', () => {
    expect(laplacianVariance(flat(2, 2, 100), 2, 2)).toBe(0)
  })
})

describe('tenengradScore', () => {
  it('imagem plana tem energia zero', () => {
    expect(tenengradScore(flat(32, 32, 128), 32, 32)).toBe(0)
  })

  it('texto nitido pontua acima de texto borrado', () => {
    const { sharp, blurred } = stripes(64, 64)
    expect(tenengradScore(sharp, 64, 64)).toBeGreaterThan(
      tenengradScore(blurred, 64, 64) * 1.5,
    )
  })

  it('imagem menor que 3x3 retorna zero', () => {
    expect(tenengradScore(flat(2, 2, 100), 2, 2)).toBe(0)
  })
})

describe('illuminationRatios', () => {
  it('pagina bem exposta (cinza medio) nao acusa glare nem sombra', () => {
    const { glareRatio, shadowRatio } = illuminationRatios(flat(16, 16, 200))
    expect(glareRatio).toBe(0)
    expect(shadowRatio).toBe(0)
  })

  it('bloco clipado conta como glare', () => {
    const gray = flat(16, 16, 200)
    // 25% dos pixels clipados (reflexo de luz).
    for (let i = 0; i < gray.length / 4; i++) {
      gray[i] = 255
    }
    const { glareRatio } = illuminationRatios(gray)
    expect(glareRatio).toBeCloseTo(0.25, 2)
  })

  it('papel branco levemente superexposto (253) NAO conta como glare', () => {
    // Papel claro sob exposicao alta chega a ~250-253 sem ser reflexo especular;
    // o limiar (254) so conta pixel realmente clipado. Guarda contra o falso
    // positivo que o review pegou.
    const gray = flat(16, 16, 253)
    const { glareRatio } = illuminationRatios(gray)
    expect(glareRatio).toBe(0)
  })

  it('regiao escura conta como sombra', () => {
    const gray = flat(16, 16, 200)
    // Metade da pagina sob sombra forte.
    for (let i = 0; i < gray.length / 2; i++) {
      gray[i] = 20
    }
    const { shadowRatio } = illuminationRatios(gray)
    expect(shadowRatio).toBeCloseTo(0.5, 2)
  })

  it('buffer vazio nao divide por zero', () => {
    const { glareRatio, shadowRatio } = illuminationRatios(new Float32Array(0))
    expect(glareRatio).toBe(0)
    expect(shadowRatio).toBe(0)
  })
})

describe('deriveQualityWarnings', () => {
  it('pagina nitida e bem iluminada nao gera avisos', () => {
    expect(
      deriveQualityWarnings({ sharpness: 200, glareRatio: 0, shadowRatio: 0 }),
    ).toEqual([])
  })

  it('nitidez abaixo do limiar gera aviso de blur', () => {
    expect(
      deriveQualityWarnings({
        sharpness: BLUR_WARN_THRESHOLD - 1,
        glareRatio: 0,
        shadowRatio: 0,
      }),
    ).toEqual(['blur'])
  })

  it('glare e sombra acima dos limiares geram os avisos respectivos', () => {
    expect(
      deriveQualityWarnings({
        sharpness: 200,
        glareRatio: 0.2,
        shadowRatio: 0.5,
      }),
    ).toEqual(['glare', 'shadow'])
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
