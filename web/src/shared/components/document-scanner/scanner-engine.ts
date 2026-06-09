import { useEffect, useState } from 'react'

// Tipos minimos do OpenCV.js e do jscanify (carregados via script, sob demanda).
export type Corner = { x: number; y: number }

export type CornerPoints = {
  topLeftCorner: Corner
  topRightCorner: Corner
  bottomLeftCorner: Corner
  bottomRightCorner: Corner
}

type CvMat = { delete(): void; data32S: Int32Array; cols: number; rows: number }
type CvMatVector = { delete(): void; size(): number; get(index: number): CvMat }
type CvSize = { delete(): void }

type OpenCvModule = {
  Mat: new () => CvMat
  MatVector: new () => CvMatVector
  Size: new (width: number, height: number) => CvSize
  imread(source: ImageSource): CvMat
  cvtColor(src: CvMat, dst: CvMat, code: number): void
  GaussianBlur(
    src: CvMat,
    dst: CvMat,
    ksize: CvSize,
    sigmaX: number,
    sigmaY?: number,
    borderType?: number,
  ): void
  Canny(src: CvMat, dst: CvMat, threshold1: number, threshold2: number): void
  getStructuringElement(shape: number, ksize: CvSize): CvMat
  morphologyEx(src: CvMat, dst: CvMat, op: number, kernel: CvMat): void
  findContours(
    image: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number,
  ): void
  contourArea(contour: CvMat): number
  arcLength(curve: CvMat, closed: boolean): number
  approxPolyDP(
    curve: CvMat,
    approxCurve: CvMat,
    epsilon: number,
    closed: boolean,
  ): void
  isContourConvex(contour: CvMat): boolean
  resize(
    src: CvMat,
    dst: CvMat,
    dsize: CvSize,
    fx?: number,
    fy?: number,
    interpolation?: number,
  ): void
  COLOR_RGBA2GRAY: number
  MORPH_RECT: number
  MORPH_CLOSE: number
  RETR_EXTERNAL: number
  CHAIN_APPROX_SIMPLE: number
  BORDER_DEFAULT: number
  INTER_AREA: number
}

export type ImageSource = HTMLCanvasElement | HTMLImageElement

// Contrato comum dos motores de deteccao de cantos. O motor OpenCV/jscanify e o
// motor DocAligner (IA) implementam isto; o WebScannerDialog injeta um deles.
// E assincrono porque a inferencia ONNX retorna Promise (o OpenCV resolve na
// hora). Devolve os 4 cantos ja ordenados/validados, ou null se nada confiavel.
export type DetectOptions = { fallback?: boolean }
export interface CornerDetector {
  detect(
    source: ImageSource,
    options?: DetectOptions,
  ): Promise<CornerPoints | null>
}

export type JscanifyInstance = {
  highlightPaper(
    image: ImageSource,
    options?: { color?: string; thickness?: number },
  ): HTMLCanvasElement
  extractPaper(
    image: ImageSource,
    width: number,
    height: number,
    cornerPoints?: CornerPoints,
  ): HTMLCanvasElement | null
  findPaperContour(img: CvMat): CvMat | null
  getCornerPoints(contour: CvMat): Partial<CornerPoints>
}

declare global {
  interface Window {
    cv?: OpenCvModule
    jscanify?: new () => JscanifyInstance
  }
}

const OPENCV_URL = '/vendor/opencv/opencv.js'
const JSCANIFY_URL = '/vendor/jscanify/jscanify.js'

export type ScannerEngineStatus = 'idle' | 'loading' | 'ready' | 'error'

let loadPromise: Promise<void> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-vendor="${src}"]`,
    )

    if (existing) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.vendor = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}.`))
    document.head.appendChild(script)
  })
}

// O OpenCV.js inicializa o WASM de forma assincrona; aguardamos cv.Mat existir.
function waitForOpenCv(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()

    const check = () => {
      if (window.cv?.Mat) {
        resolve()
        return
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error('Tempo esgotado ao iniciar o motor de digitalizacao.'))
        return
      }

      window.setTimeout(check, 50)
    }

    check()
  })
}

// Carrega OpenCV.js + jscanify uma unica vez (sob demanda, somente no browser).
export function loadScannerEngine(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      await loadScript(OPENCV_URL)
      await waitForOpenCv()
      await loadScript(JSCANIFY_URL)
    })().catch((error) => {
      loadPromise = null
      throw error
    })
  }

  return loadPromise
}

export function createScanner(): JscanifyInstance {
  if (!window.jscanify) {
    throw new Error('Motor de digitalizacao indisponivel.')
  }

  return new window.jscanify()
}

function distance(a: Corner, b: Corner): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Area do quadrilatero (formula de Gauss/shoelace) na ordem TL -> TR -> BR -> BL.
function quadArea(corners: CornerPoints): number {
  const points = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]

  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }

  return Math.abs(area) / 2
}

// Reordena 4 pontos quaisquer em TL, TR, BR, BL de forma robusta: o canto
// superior-esquerdo tem a menor soma (x+y) e o inferior-direito a maior; o
// superior-direito tem o menor (y-x) e o inferior-esquerdo o maior.
export function orderCorners(corners: CornerPoints): CornerPoints {
  const points = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y))
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x))

  return {
    topLeftCorner: bySum[0],
    bottomRightCorner: bySum[3],
    topRightCorner: byDiff[0],
    bottomLeftCorner: byDiff[3],
  }
}

function scaleCorners(corners: CornerPoints, factor: number): CornerPoints {
  const scale = (p: Corner): Corner => ({ x: p.x * factor, y: p.y * factor })
  return {
    topLeftCorner: scale(corners.topLeftCorner),
    topRightCorner: scale(corners.topRightCorner),
    bottomRightCorner: scale(corners.bottomRightCorner),
    bottomLeftCorner: scale(corners.bottomLeftCorner),
  }
}

// Resolucao de trabalho da deteccao. Os parametros (blur/morfologia) sao fixos
// em pixels e so funcionam bem em imagens pequenas; detectar acima disso (foto
// em resolucao cheia, ~4000px) faz as bordas do documento nao fecharem.
const MAX_DETECT_DIM = 640

// Descarta deteccoes improvaveis: contorno minusculo (ruido), o frame inteiro
// (sem documento real) ou lados degenerados — nesses casos e melhor usar os
// cantos padrao do que aplicar um recorte/perspectiva torto.
export function isPlausibleQuad(
  corners: CornerPoints,
  width: number,
  height: number,
): boolean {
  const imageArea = width * height
  const area = quadArea(corners)

  if (area < imageArea * 0.12 || area > imageArea * 0.998) {
    return false
  }

  const sides = [
    distance(corners.topLeftCorner, corners.topRightCorner),
    distance(corners.topRightCorner, corners.bottomRightCorner),
    distance(corners.bottomRightCorner, corners.bottomLeftCorner),
    distance(corners.bottomLeftCorner, corners.topLeftCorner),
  ]

  return Math.min(...sides) >= Math.min(width, height) * 0.2
}

// Detector robusto: encontra o MAIOR quadrilatero convexo da imagem via
// Canny + fechamento morfologico + approxPolyDP. Bem mais confiavel que o
// "maior contorno por area" do jscanify em fundos texturizados (madeira,
// sombras) ou com objetos competindo, onde aquele funde o documento com o
// fundo. Recebe um Mat ja lido (nao o libera) e devolve 4 pontos crus.
function detectDocumentQuad(cv: OpenCvModule, mat: CvMat): CornerPoints | null {
  const gray = new cv.Mat()
  const blur = new cv.Mat()
  const edges = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  let kernel: CvMat | null = null
  // cv.Size aloca na heap do WASM e precisa de delete() (o loop ao vivo roda
  // ~4x/s, entao vazar aqui cresceria rapido).
  let blurKsize: CvSize | null = null
  let morphKsize: CvSize | null = null
  let best: CornerPoints | null = null

  try {
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY)
    blurKsize = new cv.Size(5, 5)
    cv.GaussianBlur(gray, blur, blurKsize, 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(blur, edges, 60, 180)
    morphKsize = new cv.Size(7, 7)
    kernel = cv.getStructuringElement(cv.MORPH_RECT, morphKsize)
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel)
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    )

    const imageArea = mat.cols * mat.rows
    let bestArea = 0

    for (let i = 0; i < contours.size(); i++) {
      // get(i) devolve uma copia propria do Mat; precisa ser liberada (o loop
      // ao vivo roda continuamente, entao vazamento aqui cresceria rapido).
      const contour = contours.get(i)

      try {
        const area = cv.contourArea(contour)

        // Mesmo piso de area do isPlausibleQuad (12%) para nao gastar
        // approxPolyDP num quad que seria descartado depois.
        if (area < imageArea * 0.12 || area > imageArea * 0.99) {
          continue
        }

        const peri = cv.arcLength(contour, true)
        const approx = new cv.Mat()

        try {
          cv.approxPolyDP(contour, approx, 0.02 * peri, true)

          // Apenas quadrilateros convexos sao candidatos a documento. A ordem
          // dos pontos vem arbitraria; orderCorners() normaliza depois.
          if (
            approx.rows === 4 &&
            cv.isContourConvex(approx) &&
            area > bestArea
          ) {
            bestArea = area
            best = {
              topLeftCorner: { x: approx.data32S[0], y: approx.data32S[1] },
              topRightCorner: { x: approx.data32S[2], y: approx.data32S[3] },
              bottomRightCorner: { x: approx.data32S[4], y: approx.data32S[5] },
              bottomLeftCorner: { x: approx.data32S[6], y: approx.data32S[7] },
            }
          }
        } finally {
          approx.delete()
        }
      } finally {
        contour.delete()
      }
    }

    return best
  } finally {
    gray.delete()
    blur.delete()
    edges.delete()
    contours.delete()
    hierarchy.delete()
    kernel?.delete()
    blurKsize?.delete()
    morphKsize?.delete()
  }
}

// Detecta automaticamente os 4 cantos do documento numa imagem/canvas.
// Tenta primeiro o detector robusto (approxPolyDP); se falhar, recorre ao
// jscanify. Reordena e valida; devolve null quando nada e confiavel.
//
// `fallback` controla o segundo motor (jscanify), que roda outro pipeline
// Canny/contorno completo. No preview ao vivo (~4fps) passamos `false` para
// nao executar dois pipelines por quadro — o proximo quadro tenta de novo.
export function detectCorners(
  scanner: JscanifyInstance,
  source: ImageSource,
  options: { fallback?: boolean } = {},
): CornerPoints | null {
  const { fallback = true } = options
  const cv = window.cv
  if (!cv) {
    return null
  }

  const mat = cv.imread(source)
  const fullWidth = mat.cols
  const fullHeight = mat.rows

  // Detecta sempre num quadro reduzido: os parametros (blur/morfologia) sao
  // fixos em pixels e so funcionam em imagens pequenas; numa foto em resolucao
  // cheia (~4000px) eles nao fecham as bordas e a deteccao falha. Detecta no
  // reduzido e escala os cantos de volta para a resolucao original (o recorte
  // continua usando a imagem cheia, sem perda de qualidade). Tambem e mais
  // rapido.
  const longest = Math.max(fullWidth, fullHeight)
  const scale = longest > MAX_DETECT_DIM ? MAX_DETECT_DIM / longest : 1

  let work = mat
  let resizeKsize: CvSize | null = null
  if (scale < 1) {
    work = new cv.Mat()
    resizeKsize = new cv.Size(
      Math.round(fullWidth * scale),
      Math.round(fullHeight * scale),
    )
    cv.resize(mat, work, resizeKsize, 0, 0, cv.INTER_AREA)
  }
  const inv = 1 / scale

  try {
    // 1) Detector robusto (maior quadrilatero convexo).
    try {
      const quad = detectDocumentQuad(cv, work)
      if (quad) {
        const ordered = orderCorners(scaleCorners(quad, inv))
        if (isPlausibleQuad(ordered, fullWidth, fullHeight)) {
          return ordered
        }
      }
    } catch {
      // Cai para o jscanify abaixo.
    }

    if (!fallback) {
      return null
    }

    // 2) Fallback jscanify (findPaperContour devolve copia propria; liberar).
    const contour = scanner.findPaperContour(work)
    if (!contour) {
      return null
    }

    try {
      const corners = scanner.getCornerPoints(contour)

      if (
        !corners.topLeftCorner ||
        !corners.topRightCorner ||
        !corners.bottomLeftCorner ||
        !corners.bottomRightCorner
      ) {
        return null
      }

      const ordered = orderCorners(scaleCorners(corners as CornerPoints, inv))

      return isPlausibleQuad(ordered, fullWidth, fullHeight) ? ordered : null
    } finally {
      contour.delete()
    }
  } finally {
    if (work !== mat) {
      work.delete()
    }
    resizeKsize?.delete()
    mat.delete()
  }
}

// Hook que carrega o motor sob demanda quando habilitado.
export function useScannerEngine(enabled: boolean): ScannerEngineStatus {
  const [status, setStatus] = useState<ScannerEngineStatus>('idle')

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    setStatus('loading')

    loadScannerEngine().then(
      () => {
        if (!cancelled) {
          setStatus('ready')
        }
      },
      () => {
        if (!cancelled) {
          setStatus('error')
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [enabled])

  return status
}
