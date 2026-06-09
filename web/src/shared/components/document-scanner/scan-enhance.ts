// Realce de paginas escaneadas com qualidade proxima a apps tipo CamScanner.
// Pipeline (100% canvas/JS — o OpenCV.js vendorizado e minimo e nao expoe os
// operadores necessarios):
//   1. Estima a iluminacao do PAPEL ignorando o texto (maximo local em grade).
//   2. Normaliza dividindo pelo fundo + niveis (ponto preto/branco) e gama.
//   3. Modo cor: realca a saturacao (mantem carimbos/assinaturas vivos).
//      Modo cinza: converte para luminancia.
//   4. Nitidez (unsharp mask) sobre a luminancia.
// Preto e branco usa limiar adaptativo (Bradley/Wellner).

export type FilterMode = 'color' | 'gray' | 'bw'

// Grade do fundo: ~96 celulas no lado maior. Celula pega o valor mais CLARO
// (papel), ignorando o texto escuro — diferente de uma media, que mistura o
// texto e escurece o fundo.
const BACKGROUND_CELLS = 96
const GRID_BLUR_RADIUS = 2

// Realce SUAVE: achata a iluminacao de forma multiplicativa (preserva o conteudo
// e NAO forca branco). Crucial para documentos coloridos/claros como CNH/RG, que
// a normalizacao agressiva "lavava". Texto preto-no-branco continua limpo via
// contraste; binarizacao forte fica so no modo preto e branco.
const PAPER_TARGET = 235 // alvo de brilho do fundo (nao e branco puro)
const ILLUM_STRENGTH = 0.55 // quanto a iluminacao e achatada (0..1)
const COLOR_CONTRAST = 1.12 // contraste leve no modo cor (fiel)
const GRAY_CONTRAST = 1.28 // contraste um pouco maior no modo cinza

const SATURATION = 1.35 // realce de cor (modo cor)
const SHARPEN_AMOUNT = 0.8 // intensidade da nitidez
const SHARPEN_RADIUS = 1 // raio do unsharp (px)

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

// Box blur separavel (passada horizontal + vertical) com janela deslizante.
// Bordas por clamp. Trabalha em 8 bits para economizar memoria.
function boxBlur(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const win = radius * 2 + 1
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)

  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let k = -radius; k <= radius; k++) {
      sum += src[row + Math.min(Math.max(k, 0), width - 1)]
    }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / win
      const xIn = Math.min(x + radius + 1, width - 1)
      const xOut = Math.max(x - radius, 0)
      sum += src[row + xIn] - src[row + xOut]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) {
      sum += tmp[Math.min(Math.max(k, 0), height - 1) * width + x]
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / win
      const yIn = Math.min(y + radius + 1, height - 1)
      const yOut = Math.max(y - radius, 0)
      sum += tmp[yIn * width + x] - tmp[yOut * width + x]
    }
  }

  return out
}

type Grid = {
  cols: number
  rows: number
  cell: number
  r: Uint8ClampedArray
  g: Uint8ClampedArray
  b: Uint8ClampedArray
}

// Estima o fundo (papel) por maximo local em grade e suaviza.
function estimatePaperGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Grid {
  const cell = Math.max(1, Math.ceil(Math.max(width, height) / BACKGROUND_CELLS))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const r = new Uint8ClampedArray(cols * rows)
  const g = new Uint8ClampedArray(cols * rows)
  const b = new Uint8ClampedArray(cols * rows)

  for (let y = 0; y < height; y++) {
    const cy = (y / cell) | 0
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const ci = cy * cols + ((x / cell) | 0)
      if (data[idx] > r[ci]) r[ci] = data[idx]
      if (data[idx + 1] > g[ci]) g[ci] = data[idx + 1]
      if (data[idx + 2] > b[ci]) b[ci] = data[idx + 2]
    }
  }

  return {
    cols,
    rows,
    cell,
    r: boxBlur(r, cols, rows, GRID_BLUR_RADIUS),
    g: boxBlur(g, cols, rows, GRID_BLUR_RADIUS),
    b: boxBlur(b, cols, rows, GRID_BLUR_RADIUS),
  }
}

// Amostra bilinear de um canal da grade na posicao (x, y) em pixels plenos.
function sampleGrid(
  channel: Uint8ClampedArray,
  cols: number,
  rows: number,
  cell: number,
  x: number,
  y: number,
): number {
  const gx = x / cell - 0.5
  const gy = y / cell - 0.5
  let x0 = Math.floor(gx)
  let y0 = Math.floor(gy)
  let fx = gx - x0
  let fy = gy - y0
  if (x0 < 0) {
    x0 = 0
    fx = 0
  }
  if (y0 < 0) {
    y0 = 0
    fy = 0
  }
  const x1 = Math.min(x0 + 1, cols - 1)
  const y1 = Math.min(y0 + 1, rows - 1)
  x0 = Math.min(x0, cols - 1)
  y0 = Math.min(y0, rows - 1)

  const v00 = channel[y0 * cols + x0]
  const v10 = channel[y0 * cols + x1]
  const v01 = channel[y1 * cols + x0]
  const v11 = channel[y1 * cols + x1]
  const top = v00 + (v10 - v00) * fx
  const bottom = v01 + (v11 - v01) * fx
  return top + (bottom - top) * fy
}

// Limiar adaptivo de Sauvola: T(x,y) = m * (1 + k*(s/R - 1)), com media (m) e
// desvio-padrao (s) locais por janela. Lida melhor com iluminacao irregular e
// fundo nao-uniforme do que so-media (Bradley). Usa imagens integrais; reaproveita
// o mesmo buffer para soma e soma-dos-quadrados (memoria estavel em fotos grandes).
const SAUVOLA_K = 0.2
const SAUVOLA_R = 128

function sauvolaThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const n = width * height
  const out = new Uint8ClampedArray(n)
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  const radius = Math.max(10, Math.floor(Math.min(width, height) / 50))

  const windowArea = (x: number, y: number): number => {
    const x1 = Math.max(0, x - radius)
    const y1 = Math.max(0, y - radius)
    const x2 = Math.min(width - 1, x + radius)
    const y2 = Math.min(height - 1, y + radius)
    return (x2 - x1 + 1) * (y2 - y1 + 1)
  }

  const windowSum = (x: number, y: number): number => {
    const x1 = Math.max(0, x - radius)
    const y1 = Math.max(0, y - radius)
    const x2 = Math.min(width - 1, x + radius)
    const y2 = Math.min(height - 1, y + radius)
    return (
      integral[(y2 + 1) * stride + (x2 + 1)] -
      integral[y1 * stride + (x2 + 1)] -
      integral[(y2 + 1) * stride + x1] +
      integral[y1 * stride + x1]
    )
  }

  // 1) integral das somas -> media local (guardada em 8 bits para economizar).
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      integral[(y + 1) * stride + (x + 1)] =
        integral[y * stride + (x + 1)] + rowSum
    }
  }
  const mean = new Uint8ClampedArray(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mean[y * width + x] = windowSum(x, y) / windowArea(x, y)
    }
  }

  // 2) integral das somas dos quadrados (reusa o buffer) -> variancia -> desvio.
  integral.fill(0)
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x]
      rowSum += v * v
      integral[(y + 1) * stride + (x + 1)] =
        integral[y * stride + (x + 1)] + rowSum
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const m = mean[idx]
      const variance = windowSum(x, y) / windowArea(x, y) - m * m
      const std = variance > 0 ? Math.sqrt(variance) : 0
      const threshold = m * (1 + SAUVOLA_K * (std / SAUVOLA_R - 1))
      out[idx] = gray[idx] < threshold ? 0 : 255
    }
  }

  return out
}

// Nitidez por unsharp mask na luminancia (aplica o realce de borda a cor toda).
function sharpen(data: Uint8ClampedArray, width: number, height: number) {
  const n = width * height
  const luma = new Uint8ClampedArray(n)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luma[j] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }

  const blurred = boxBlur(luma, width, height, SHARPEN_RADIUS)

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const delta = (luma[j] - blurred[j]) * SHARPEN_AMOUNT
    data[i] = clamp8(data[i] + delta)
    data[i + 1] = clamp8(data[i + 1] + delta)
    data[i + 2] = clamp8(data[i + 2] + delta)
  }
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
    const bw = sauvolaThreshold(gray, width, height)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      data[i] = bw[j]
      data[i + 1] = bw[j]
      data[i + 2] = bw[j]
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  const grid = estimatePaperGrid(data, width, height)
  const isGray = mode === 'gray'
  const contrast = isGray ? GRAY_CONTRAST : COLOR_CONTRAST

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const bgR = sampleGrid(grid.r, grid.cols, grid.rows, grid.cell, x, y)
      const bgG = sampleGrid(grid.g, grid.cols, grid.rows, grid.cell, x, y)
      const bgB = sampleGrid(grid.b, grid.cols, grid.rows, grid.cell, x, y)

      // Fator multiplicativo: levanta sombra (fundo escuro) sem estourar onde o
      // fundo ja e claro. Preserva o conteudo colorido/claro (CNH/RG).
      const fR = 1 + ILLUM_STRENGTH * (PAPER_TARGET / (bgR < 1 ? 1 : bgR) - 1)
      const fG = 1 + ILLUM_STRENGTH * (PAPER_TARGET / (bgG < 1 ? 1 : bgG) - 1)
      const fB = 1 + ILLUM_STRENGTH * (PAPER_TARGET / (bgB < 1 ? 1 : bgB) - 1)

      let r = (data[idx] * fR - 128) * contrast + 128
      let g = (data[idx + 1] * fG - 128) * contrast + 128
      let b = (data[idx + 2] * fB - 128) * contrast + 128

      if (isGray) {
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        r = lum
        g = lum
        b = lum
      } else {
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        r = lum + (r - lum) * SATURATION
        g = lum + (g - lum) * SATURATION
        b = lum + (b - lum) * SATURATION
      }

      data[idx] = clamp8(r)
      data[idx + 1] = clamp8(g)
      data[idx + 2] = clamp8(b)
    }
  }

  sharpen(data, width, height)

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
