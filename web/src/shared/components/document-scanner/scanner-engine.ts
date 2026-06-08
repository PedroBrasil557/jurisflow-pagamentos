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

type OpenCvModule = {
  Mat: new () => CvMat
  imread(source: HTMLCanvasElement | HTMLImageElement): CvMat
}

type ImageSource = HTMLCanvasElement | HTMLImageElement

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
function orderCorners(corners: CornerPoints): CornerPoints {
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

// Descarta deteccoes improvaveis: contorno minusculo (ruido), o frame inteiro
// (sem documento real) ou lados degenerados — nesses casos e melhor usar os
// cantos padrao do que aplicar um recorte/perspectiva torto.
function isPlausibleQuad(
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

// Detecta automaticamente os 4 cantos do documento numa imagem/canvas.
// Reordena e valida o resultado; devolve null quando a deteccao nao e confiavel.
export function detectCorners(
  scanner: JscanifyInstance,
  source: ImageSource,
): CornerPoints | null {
  if (!window.cv) {
    return null
  }

  const mat = window.cv.imread(source)
  // findPaperContour devolve uma copia propria do contorno; precisa ser liberada.
  let contour: CvMat | null = null

  try {
    contour = scanner.findPaperContour(mat)

    if (!contour) {
      return null
    }

    const corners = scanner.getCornerPoints(contour)

    if (
      !corners.topLeftCorner ||
      !corners.topRightCorner ||
      !corners.bottomLeftCorner ||
      !corners.bottomRightCorner
    ) {
      return null
    }

    const ordered = orderCorners(corners as CornerPoints)

    return isPlausibleQuad(ordered, mat.cols, mat.rows) ? ordered : null
  } finally {
    contour?.delete()
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
