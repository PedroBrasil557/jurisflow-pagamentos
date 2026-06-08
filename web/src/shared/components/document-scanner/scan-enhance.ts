// Realce de paginas escaneadas ("cara de scan"): cor com remocao de sombra,
// tons de cinza normalizados e preto e branco com limiar adaptativo.
//
// Quando o OpenCV.js ja esta carregado (o jscanify depende dele), usamos seus
// operadores (qualidade CamScanner). Caso contrario, caimos em implementacoes
// equivalentes em JS puro, para o realce funcionar mesmo sem o motor.

export type FilterMode = 'color' | 'gray' | 'bw'

// Tipos minimos do OpenCV.js usados aqui (o modulo e carregado via script).
type CvMat = { delete(): void; cols: number; rows: number }
type CvMatVector = {
  delete(): void
  get(index: number): CvMat
  push_back(mat: CvMat): void
}
type CvSize = { width: number; height: number }

interface OpenCv {
  Mat: new () => CvMat
  MatVector: new () => CvMatVector
  Size: new (width: number, height: number) => CvSize
  imread(source: HTMLCanvasElement): CvMat
  imshow(canvas: HTMLCanvasElement, mat: CvMat): void
  cvtColor(src: CvMat, dst: CvMat, code: number): void
  split(src: CvMat, dst: CvMatVector): void
  merge(src: CvMatVector, dst: CvMat): void
  dilate(src: CvMat, dst: CvMat, kernel: CvMat): void
  medianBlur(src: CvMat, dst: CvMat, ksize: number): void
  absdiff(a: CvMat, b: CvMat, dst: CvMat): void
  bitwise_not(src: CvMat, dst: CvMat): void
  normalize(
    src: CvMat,
    dst: CvMat,
    alpha: number,
    beta: number,
    normType: number,
    dtype: number,
  ): void
  adaptiveThreshold(
    src: CvMat,
    dst: CvMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    c: number,
  ): void
  getStructuringElement(shape: number, ksize: CvSize): CvMat
  COLOR_RGBA2RGB: number
  COLOR_RGB2GRAY: number
  ADAPTIVE_THRESH_GAUSSIAN_C: number
  THRESH_BINARY: number
  MORPH_RECT: number
  NORM_MINMAX: number
  CV_8U: number
}

function getOpenCv(): OpenCv | null {
  const cv = (globalThis as { cv?: Partial<OpenCv> }).cv
  // So consideramos pronto se as funcoes que usamos existirem (WASM inicializado).
  if (cv?.Mat && cv.adaptiveThreshold && cv.medianBlur && cv.getStructuringElement) {
    return cv as OpenCv
  }
  return null
}

// Aplica o filtro escolhido e devolve um novo canvas (nunca muta a origem).
export function enhanceWithFilter(
  source: HTMLCanvasElement,
  mode: FilterMode,
): HTMLCanvasElement {
  const cv = getOpenCv()

  if (cv) {
    try {
      return enhanceWithOpenCv(cv, source, mode)
    } catch {
      // Em qualquer falha do OpenCV (memoria/WASM), cai no realce em JS.
    }
  }

  return enhanceWithJs(source, mode)
}

// ---------------------------------------------------------------------------
// Caminho OpenCV.js
// ---------------------------------------------------------------------------

function matToCanvas(cv: OpenCv, mat: CvMat): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  cv.imshow(canvas, mat)
  return canvas
}

// Estima a iluminacao de fundo (dilate + mediana) e a remove, deixando o fundo
// branco e o conteudo realcado — o classico "remover sombra" de scanners.
function removeShadowPlane(
  cv: OpenCv,
  plane: CvMat,
  track: <T extends { delete(): void }>(m: T) => T,
): CvMat {
  const kernel = track(
    cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)),
  )
  const dilated = track(new cv.Mat())
  cv.dilate(plane, dilated, kernel)

  const background = track(new cv.Mat())
  // Mediana grande -> estimativa suave da iluminacao (ignora o texto).
  cv.medianBlur(dilated, background, 21)

  const diff = track(new cv.Mat())
  cv.absdiff(plane, background, diff)

  const inverted = track(new cv.Mat())
  cv.bitwise_not(diff, inverted)

  const normalized = track(new cv.Mat())
  cv.normalize(inverted, normalized, 0, 255, cv.NORM_MINMAX, cv.CV_8U)

  return normalized
}

function enhanceWithOpenCv(
  cv: OpenCv,
  source: HTMLCanvasElement,
  mode: FilterMode,
): HTMLCanvasElement {
  const mats: { delete(): void }[] = []
  const track = <T extends { delete(): void }>(mat: T): T => {
    mats.push(mat)
    return mat
  }

  try {
    const src = track(cv.imread(source))
    const rgb = track(new cv.Mat())
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)

    if (mode === 'color') {
      // Remocao de sombra por canal -> fundo branco preservando as cores.
      const channels = track(new cv.MatVector())
      cv.split(rgb, channels)
      const out = track(new cv.MatVector())
      for (let i = 0; i < 3; i++) {
        const channel = track(channels.get(i))
        out.push_back(removeShadowPlane(cv, channel, track))
      }
      const merged = track(new cv.Mat())
      cv.merge(out, merged)
      return matToCanvas(cv, merged)
    }

    const gray = track(new cv.Mat())
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY)
    const normalized = removeShadowPlane(cv, gray, track)

    if (mode === 'gray') {
      return matToCanvas(cv, normalized)
    }

    // bw: limiar adaptivo gaussiano sobre o cinza ja sem sombra -> texto nitido.
    const bw = track(new cv.Mat())
    cv.adaptiveThreshold(
      normalized,
      bw,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      31,
      12,
    )
    return matToCanvas(cv, bw)
  } finally {
    for (const mat of mats) {
      mat.delete()
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback em JS puro (sem OpenCV)
// ---------------------------------------------------------------------------

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

// Estica um canal entre os percentis 1% e 99% (auto-contraste / "auto-niveis").
function stretchChannel(data: Uint8ClampedArray, offset: number) {
  const histogram = new Array(256).fill(0)
  let count = 0
  for (let i = offset; i < data.length; i += 4) {
    histogram[data[i]]++
    count++
  }

  const lowCut = count * 0.01
  const highCut = count * 0.99
  let low = 0
  let high = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += histogram[v]
    if (acc >= lowCut) {
      low = v
      break
    }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += histogram[v]
    if (acc >= highCut) {
      high = v
      break
    }
  }

  if (high <= low) {
    return
  }

  const scale = 255 / (high - low)
  for (let i = offset; i < data.length; i += 4) {
    const value = (data[i] - low) * scale
    data[i] = value < 0 ? 0 : value > 255 ? 255 : value
  }
}

// Limiar adaptivo (Bradley/Wellner) via imagem integral: media local por janela.
function adaptiveThresholdJs(
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

function enhanceWithJs(
  source: HTMLCanvasElement,
  mode: FilterMode,
): HTMLCanvasElement {
  const canvas = cloneToCanvas(source)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return source
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  if (mode === 'color') {
    stretchChannel(data, 0)
    stretchChannel(data, 1)
    stretchChannel(data, 2)
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  const gray = new Uint8ClampedArray(data.length / 4)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }

  const result =
    mode === 'bw'
      ? adaptiveThresholdJs(gray, canvas.width, canvas.height)
      : gray

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    data[i] = result[j]
    data[i + 1] = result[j]
    data[i + 2] = result[j]
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
