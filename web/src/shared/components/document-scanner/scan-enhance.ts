// Realce de paginas escaneadas ("cara de scan"): cor e tons de cinza com
// remocao de iluminacao/sombra (fundo branco) e preto e branco com limiar
// adaptativo. Implementacao 100% em canvas/JS — o OpenCV.js vendorizado e um
// build minimo (so o que o jscanify usa) e nao expoe os operadores necessarios.

export type FilterMode = 'color' | 'gray' | 'bw'

// Lado maior do mapa de fundo (iluminacao). Pequeno = fundo bem suavizado, que
// e o que queremos para estimar a luz da pagina e dividir por ela.
const BACKGROUND_MAX_SIDE = 110

function clamp8(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

function cloneToCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(source, 0, 0)
  }
  return canvas
}

type Background = {
  width: number
  height: number
  data: Uint8ClampedArray
}

// Estima a iluminacao de fundo reduzindo a imagem (o downscale ja faz a media/
// suavizacao). Cada pixel pleno depois consulta esse mapa para normalizar.
function estimateBackground(source: HTMLCanvasElement): Background | null {
  const scale = Math.min(
    1,
    BACKGROUND_MAX_SIDE / Math.max(source.width, source.height),
  )
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  ctx.imageSmoothingEnabled = true
  ctx.drawImage(source, 0, 0, width, height)

  return { width, height, data: ctx.getImageData(0, 0, width, height).data }
}

// Limiar adaptivo (Bradley/Wellner) via imagem integral: media local por janela.
function adaptiveThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length)
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))

  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      integral[(y + 1) * stride + (x + 1)] =
        integral[y * stride + (x + 1)] + rowSum
    }
  }

  const radius = Math.max(8, Math.floor(Math.min(width, height) / 30))
  const t = 0.15

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius)
    const y2 = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius)
      const x2 = Math.min(width - 1, x + radius)
      const area = (x2 - x1 + 1) * (y2 - y1 + 1)
      const sum =
        integral[(y2 + 1) * stride + (x2 + 1)] -
        integral[y1 * stride + (x2 + 1)] -
        integral[(y2 + 1) * stride + x1] +
        integral[y1 * stride + x1]
      const mean = sum / area
      out[y * width + x] = gray[y * width + x] < mean * (1 - t) ? 0 : 255
    }
  }

  return out
}

// Aplica o filtro escolhido e devolve um novo canvas (nunca muta a origem).
export function enhanceWithFilter(
  source: HTMLCanvasElement,
  mode: FilterMode,
): HTMLCanvasElement {
  const canvas = cloneToCanvas(source)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }

  const width = canvas.width
  const height = canvas.height
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  if (mode === 'bw') {
    const gray = new Uint8ClampedArray(width * height)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    }
    const bw = adaptiveThreshold(gray, width, height)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      data[i] = bw[j]
      data[i + 1] = bw[j]
      data[i + 2] = bw[j]
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  // Cor / cinza: normaliza a iluminacao dividindo cada pixel pelo fundo local
  // (deixa o fundo branco, realca o conteudo). Sem fundo, faz so o realce base.
  const background = estimateBackground(source)
  // Ganho do realce: result = 255 - ganho * (fundo - pixel). Fundo ~ pixel vira
  // branco; quanto mais escuro que o fundo (texto), mais escurece — evita o
  // aspecto "lavado" de so dividir pelo fundo.
  const gain = 1.5
  const isGray = mode === 'gray'

  for (let y = 0; y < height; y++) {
    const by = background
      ? Math.min(background.height - 1, Math.floor((y * background.height) / height))
      : 0
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4

      let bgR = 255
      let bgG = 255
      let bgB = 255
      if (background) {
        const bx = Math.min(
          background.width - 1,
          Math.floor((x * background.width) / width),
        )
        const bIdx = (by * background.width + bx) * 4
        bgR = background.data[bIdx]
        bgG = background.data[bIdx + 1]
        bgB = background.data[bIdx + 2]
      }

      let r = clamp8(255 - (bgR - data[idx]) * gain)
      let g = clamp8(255 - (bgG - data[idx + 1]) * gain)
      let b = clamp8(255 - (bgB - data[idx + 2]) * gain)

      if (isGray) {
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        r = lum
        g = lum
        b = lum
      }

      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
