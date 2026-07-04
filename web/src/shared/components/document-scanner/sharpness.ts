// Gate de qualidade da pagina recortada: nitidez (variancia do Laplaciano +
// Tenengrad) e defeitos de iluminacao (glare especular / sombra forte) sobre a
// luminancia. Pagina tremida tem bordas suaves -> Laplaciano/Tenengrad baixos;
// reflexo de flash/luz satura um bloco de pixels; sombra forte escurece uma
// regiao grande. Tudo AVISO, nao bloqueio: documento com pouco texto (ex.:
// verso quase em branco) pontua baixo sem estar tremido.
//
// As medidas rodam ANTES do filtro de realce (o unsharp do enhance inflaria a
// variancia e mascararia o tremido) e num tamanho fixo, para os limiares nao
// dependerem da resolucao da captura.

import { toLuminance } from './luminance'

// Lado longo usado na medicao. Fixo: a mesma cena medida a 700px e a 3500px da
// variancias muito diferentes — normalizar o tamanho e o que torna o limiar
// comparavel entre aparelhos/fontes.
export const SHARPNESS_METRIC_LONG_EDGE = 700

// Limiar de aviso (empirico). Paginas de documento nitidas a 700px tipicamente
// ficam bem acima de 100; tremido forte fica < 20. O valor baixo e proposital:
// preferimos falso-negativo (tremido leve passa) a incomodar em pagina valida.
export const BLUR_WARN_THRESHOLD = 30

// Fracao de pixels CLIPADOS (>= 254) acima da qual ha provavel reflexo
// especular (glare) sobre o documento. Papel bem exposto fica em ~200-235 com
// a auto-exposicao da camera; o limiar apertado (254, nao ~250) evita acusar
// papel branco levemente superexposto — so bloco realmente clipado conta.
// Limiar pendente de calibracao de campo (as metricas vao na telemetria do
// scan/complete justamente para isso).
export const GLARE_WARN_RATIO = 0.05
const GLARE_LUMA_MIN = 254

// Fracao de pixels muito escuros (< 60) acima da qual ha provavel sombra forte
// cobrindo o documento. Texto normal ocupa poucos % da pagina; 25%+ escuro e
// sombra da mao/celular, nao conteudo.
export const SHADOW_WARN_RATIO = 0.25

export type PageQualityWarning = 'blur' | 'glare' | 'shadow'

export type PageQuality = {
  // Variancia do Laplaciano @700px (metrica principal do aviso de tremido).
  sharpness: number
  // Energia media do gradiente de Sobel @700px. Nao dispara aviso sozinho
  // (limiar ainda sem calibracao de campo) — vai na telemetria para calibrar.
  tenengrad: number
  glareRatio: number
  shadowRatio: number
  warnings: PageQualityWarning[]
}

// Variancia do Laplaciano (kernel de 4 vizinhos) sobre um buffer de luminancia.
// Percorre so o interior (bordas ficam fora — o clamp criaria gradiente falso).
// Pura e sem DOM para ser testavel; retorna 0 para imagens menores que 3x3.
export function laplacianVariance(
  gray: Float32Array,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) {
    return 0
  }

  const count = (width - 2) * (height - 2)
  let sum = 0
  let sumSq = 0

  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const v =
        4 * gray[i] -
        gray[i - 1] -
        gray[i + 1] -
        gray[i - width] -
        gray[i + width]
      sum += v
      sumSq += v * v
    }
  }

  const mean = sum / count
  return sumSq / count - mean * mean
}

// Tenengrad: media do quadrado da magnitude do gradiente de Sobel 3x3. Medida
// de foco classica, mais robusta a ruido que o Laplaciano (kernel maior e
// quadrado da magnitude). Mesmas convencoes: interior apenas, pura, 0 se < 3x3.
export function tenengradScore(
  gray: Float32Array,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) {
    return 0
  }

  const count = (width - 2) * (height - 2)
  let sum = 0

  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const gx =
        gray[i - width + 1] +
        2 * gray[i + 1] +
        gray[i + width + 1] -
        gray[i - width - 1] -
        2 * gray[i - 1] -
        gray[i + width - 1]
      const gy =
        gray[i + width - 1] +
        2 * gray[i + width] +
        gray[i + width + 1] -
        gray[i - width - 1] -
        2 * gray[i - width] -
        gray[i - width + 1]
      sum += gx * gx + gy * gy
    }
  }

  return sum / count
}

// Fracoes de pixels clipados (glare) e muito escuros (sombra). Pura.
export function illuminationRatios(gray: Float32Array): {
  glareRatio: number
  shadowRatio: number
} {
  if (gray.length === 0) {
    return { glareRatio: 0, shadowRatio: 0 }
  }
  let glare = 0
  let shadow = 0
  for (const v of gray) {
    if (v >= GLARE_LUMA_MIN) {
      glare += 1
    } else if (v < 60) {
      shadow += 1
    }
  }
  return { glareRatio: glare / gray.length, shadowRatio: shadow / gray.length }
}

// Re-export: os testes e consumidores do gate importam daqui; a implementacao
// unica (compartilhada com scan-enhance.ts) vive em luminance.ts.
export { toLuminance }

// Deriva os avisos a partir das metricas (pura, testavel).
export function deriveQualityWarnings(metrics: {
  sharpness: number
  glareRatio: number
  shadowRatio: number
}): PageQualityWarning[] {
  const warnings: PageQualityWarning[] = []
  if (metrics.sharpness < BLUR_WARN_THRESHOLD) {
    warnings.push('blur')
  }
  if (metrics.glareRatio > GLARE_WARN_RATIO) {
    warnings.push('glare')
  }
  if (metrics.shadowRatio > SHADOW_WARN_RATIO) {
    warnings.push('shadow')
  }
  return warnings
}

// Mede a qualidade de um canvas (reduzido ao tamanho fixo de medicao). Retorna
// null quando o contexto 2d nao esta disponivel — o chamador simplesmente nao
// avisa (a metrica e best-effort, nunca pode quebrar a captura).
export function assessPageQuality(
  source: HTMLCanvasElement,
): PageQuality | null {
  const longEdge = Math.max(source.width, source.height)
  if (longEdge === 0) {
    return null
  }
  const scale = Math.min(1, SHARPNESS_METRIC_LONG_EDGE / longEdge)
  const width = Math.max(3, Math.round(source.width * scale))
  const height = Math.max(3, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return null
  }
  ctx.drawImage(source, 0, 0, width, height)

  try {
    const data = ctx.getImageData(0, 0, width, height).data
    const gray = toLuminance(data)
    const sharpness = laplacianVariance(gray, width, height)
    const tenengrad = tenengradScore(gray, width, height)
    const { glareRatio, shadowRatio } = illuminationRatios(gray)
    return {
      sharpness,
      tenengrad,
      glareRatio,
      shadowRatio,
      warnings: deriveQualityWarnings({ sharpness, glareRatio, shadowRatio }),
    }
  } catch {
    return null
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
