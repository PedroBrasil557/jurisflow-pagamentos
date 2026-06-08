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

// Niveis aplicados sobre a razao pixel/fundo (papel ~ 1.0).
const WHITE_POINT = 0.88 // razao >= isto -> branco puro
const BLACK_POINT = 0.15 // razao <= isto -> preto puro
const GAMMA = 1.1 // > 1 escurece os meios-tons (texto mais firme)

const SATURATION = 1.45 // realce de cor (modo cor)
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

// Razao pixel/fundo -> niveis (ponto preto/branco) -> gama -> 0..255.
function applyLevels(pixel: number, background: number): number {
  const ratio = pixel / (background < 1 ? 1 : background)
  let t = ratio > WHITE_POINT ? WHITE_POINT : ratio
  t = (t - BLACK_POINT) / (WHITE_POINT - BLACK_POINT)
  if (t < 0) {
    t = 0
  }
  return clamp8(t ** GAMMA * 255)
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
    const bw = adaptiveThreshold(gray, width, height)
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const bgR = sampleGrid(grid.r, grid.cols, grid.rows, grid.cell, x, y)
      const bgG = sampleGrid(grid.g, grid.cols, grid.rows, grid.cell, x, y)
      const bgB = sampleGrid(grid.b, grid.cols, grid.rows, grid.cell, x, y)

      let r = applyLevels(data[idx], bgR)
      let g = applyLevels(data[idx + 1], bgG)
      let b = applyLevels(data[idx + 2], bgB)

      if (isGray) {
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        r = lum
        g = lum
        b = lum
      } else {
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        r = clamp8(lum + (r - lum) * SATURATION)
        g = clamp8(lum + (g - lum) * SATURATION)
        b = clamp8(lum + (b - lum) * SATURATION)
      }

      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
    }
  }

  sharpen(data, width, height)

  ctx.putImageData(imageData, 0, 0)
  return canvas
}
