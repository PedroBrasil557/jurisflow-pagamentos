// Estrategia de captura por plataforma (modo HD do scanner):
//
// - Android/Blink: ImageCapture.takePhoto() — still real do sensor (12-50 MP,
//   pipeline de foto com autofoco/HDR), muito acima do frame de video (~2-8 MP).
//   Com validacao anti-"grabFrame disfarcado" (aparelhos que devolvem o frame de
//   video no takePhoto) e fallback pro frame em QUALQUER falha — o caminho HD
//   nunca fica pior que o comportamento padrao.
// - iOS/WebKit (todos os browsers, Chrome incluso): takePhoto nao existe no
//   estavel (Safari 26; em implementacao no 27) — o shutter captura o frame do
//   video (viewfinder com borda ao vivo vence: sair para a camera do sistema a
//   cada pagina foi rejeitado em uso real). A camera nativa (input capture,
//   still 12-48 MP) fica como botao secundario "Alta resolucao". O feature-
//   detect abaixo liga o takePhoto automaticamente quando o WebKit estabilizar.

import { readJpegDimensions, rotateCanvas90 } from './image-normalize'

// Tipos minimos da API (o lib.dom do TypeScript nao os traz em todas as
// versoes; alguns WebViews expoem o construtor sem implementar os metodos —
// por isso todo acesso e defensivo).
type MediaSettingsRange = { max?: number; min?: number; step?: number }
type PhotoCapabilities = {
  imageWidth?: MediaSettingsRange
  imageHeight?: MediaSettingsRange
}
type PhotoSettings = { imageWidth?: number; imageHeight?: number }
interface ImageCaptureLike {
  getPhotoCapabilities(): Promise<PhotoCapabilities>
  takePhoto(settings?: PhotoSettings): Promise<Blob>
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike

// No iOS (todos os browsers usam WebKit) as capacidades de camera sao as do
// Safari — e o caminho de alta resolucao e a camera nativa via input capture.
export function isLikelyIOS(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  const iPadOS =
    ua.includes('Macintosh') &&
    typeof document !== 'undefined' &&
    'ontouchend' in document
  return /iPad|iPhone|iPod/.test(ua) || iPadOS
}

// Foco continuo no documento (best-effort, Android). O WebKit nao expoe
// focusMode; em Blink a maioria dos aparelhos aceita — melhora o still.
export async function applyDocumentFocus(
  track: MediaStreamTrack,
): Promise<void> {
  try {
    const caps = track.getCapabilities?.() as
      | { focusMode?: string[] }
      | undefined
    if (caps?.focusMode?.includes('continuous')) {
      await track.applyConstraints({
        advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
      })
    }
  } catch {
    // sem suporte — o autofoco default do aparelho segue valendo.
  }
}

// Still "falso": alguns drivers/OEMs devolvem no takePhoto um bitmap na
// resolucao do video em vez do shutter real. Heuristica dupla (dimensoes do
// header JPEG vs video + tamanho do blob): foto real e maior que o frame OU
// pesa bem mais que um frame comprimido (~30 KB); na duvida, aceita (o still
// nunca e pior que o frame).
const FAKE_STILL_MAX_BYTES = 200_000

// Foto do SENSOR via ImageCapture.takePhoto() (Chrome/Android; feature-detect
// cobre o iOS quando o Safari 27 estabilizar). QUALQUER falha devolve null e o
// chamador cai no frame de video.
export async function takeSensorPhoto(
  track: MediaStreamTrack,
): Promise<Blob | null> {
  const Ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture
  if (typeof Ctor !== 'function') {
    return null
  }
  try {
    const capture = new Ctor(track)

    // Pede a maior resolucao de FOTO do sensor. Sem isto, varios aparelhos
    // devolvem o still na resolucao do video e o ganho de nitidez some.
    let settings: PhotoSettings | undefined
    try {
      const caps = await capture.getPhotoCapabilities()
      if (caps.imageWidth?.max) {
        settings = { imageWidth: caps.imageWidth.max }
      }
    } catch {
      // Sem capabilities: segue com o default do aparelho.
    }

    try {
      return await capture.takePhoto(settings)
    } catch {
      // Alguns aparelhos rejeitam imageWidth fora da grade suportada; o
      // default ainda tende a ser melhor que o frame de video.
      return await capture.takePhoto()
    }
  } catch {
    return null
  }
}

// Desenha o frame atual do video num canvas (o caminho padrao/fallback).
export function frameToCanvas(
  video: HTMLVideoElement,
): HTMLCanvasElement | null {
  if (!video.videoWidth) {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

export type ShutterCaptureSource = 'still' | 'frame'

export type ShutterCapture = {
  canvas: HTMLCanvasElement
  source: ShutterCaptureSource
  // Lado longo (px) da captura BRUTA (antes da normalizacao) — telemetria.
  rawLongEdgePx: number | null
}

// Captura do shutter no modo HD: tenta o still do sensor e cai no frame de
// video em qualquer falha/still falso. Devolve tambem a origem e a resolucao
// bruta (telemetria). O canvas retornado ja sai normalizado no caminho still
// (decodeToWorkingCanvas limita) e na resolucao do video no caminho frame.
export async function captureHdShutter(input: {
  video: HTMLVideoElement
  track: MediaStreamTrack | null
  // decodeToWorkingCanvas injetado para o still nao materializar 50 MP.
  decodeStill: (photo: Blob) => Promise<HTMLCanvasElement>
}): Promise<ShutterCapture | null> {
  const { video, track } = input
  const videoLongEdge = Math.max(video.videoWidth, video.videoHeight)

  if (track) {
    const photo = await takeSensorPhoto(track)
    if (photo) {
      // Header JPEG lido UMA vez: serve a validacao anti-still-falso e a
      // telemetria de resolucao bruta.
      const dims = await readJpegDimensions(photo)
      const rawLongEdgePx = dims ? Math.max(dims.width, dims.height) : null
      const likelyFake =
        photo.size <= FAKE_STILL_MAX_BYTES &&
        rawLongEdgePx !== null &&
        rawLongEdgePx <= videoLongEdge
      if (!likelyFake) {
        try {
          let canvas = await input.decodeStill(photo)
          // Alguns aparelhos entregam o still na orientacao do sensor
          // (paisagem) com o viewfinder em retrato — gira para casar com o que
          // o usuario viu (senao a pagina sai deitada no PDF).
          const videoPortrait = video.videoHeight > video.videoWidth
          const photoPortrait = canvas.height > canvas.width
          if (videoPortrait !== photoPortrait) {
            const rotated = rotateCanvas90(canvas)
            if (rotated !== canvas) {
              canvas.width = 0
              canvas.height = 0
            }
            canvas = rotated
          }
          return { canvas, source: 'still', rawLongEdgePx }
        } catch {
          // decode do still falhou — cai no frame abaixo.
        }
      }
    }
  }

  const frame = frameToCanvas(video)
  return frame
    ? { canvas: frame, source: 'frame', rawLongEdgePx: videoLongEdge }
    : null
}
