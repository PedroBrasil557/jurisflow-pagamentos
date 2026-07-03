// Metrica de nitidez da pagina recortada: variancia do Laplaciano sobre a
// luminancia. Pagina tremida/desfocada tem bordas suaves -> Laplaciano baixo em
// toda parte -> variancia baixa. E um AVISO, nao um bloqueio: documento com
// pouco texto (ex.: verso quase em branco) pontua baixo sem estar tremido.
//
// A medida roda ANTES do filtro de realce (o unsharp do enhance inflaria a
// variancia e mascararia o tremido) e num tamanho fixo, para o limiar nao
// depender da resolucao da captura.

// Lado longo usado na medicao. Fixo: a mesma cena medida a 700px e a 3500px da
// variancias muito diferentes — normalizar o tamanho e o que torna o limiar
// comparavel entre aparelhos/fontes.
export const SHARPNESS_METRIC_LONG_EDGE = 700

// Limiar de aviso (empirico). Paginas de documento nitidas a 700px tipicamente
// ficam bem acima de 100; tremido forte fica < 20. O valor baixo e proposital:
// preferimos falso-negativo (tremido leve passa) a incomodar em pagina valida.
export const BLUR_WARN_THRESHOLD = 30

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

// Converte ImageData RGBA em luminancia (Rec. 601, a mesma do scan-enhance).
export function toLuminance(data: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(data.length / 4)
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  }
  return gray
}

// Mede a nitidez de um canvas (reduzido ao tamanho fixo de medicao). Retorna
// null quando o contexto 2d nao esta disponivel — o chamador simplesmente nao
// avisa (a metrica e best-effort, nunca pode quebrar a captura).
export function estimateSharpness(source: HTMLCanvasElement): number | null {
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
    return laplacianVariance(toLuminance(data), width, height)
  } catch {
    return null
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
