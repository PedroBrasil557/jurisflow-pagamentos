import {
  Check,
  ChevronLeft,
  Crop,
  Image as ImageIcon,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { type DocAlignerStatus, useDocAlignerDetector } from './docaligner'
import { enhanceWithFilter, type FilterMode } from './scan-enhance'
import { buildScanFileName, pagesToPdfFile, type ScanPage } from './scan-to-pdf'
import {
  type CornerPoints,
  createScanner,
  detectCorners,
  useScannerEngine,
} from './scanner-engine'

type WebScannerDialogProps = {
  open: boolean
  onClose: () => void
  onComplete: (file: File) => void
  // Quando true, usa o DocAligner (IA) como detector primario de bordas, com o
  // OpenCV/jscanify como fallback. Provider 'docaligner' nas Configuracoes.
  useMl?: boolean
}

type ScannedPage = {
  id: string
  originalDataUrl: string // quadro original (para reeditar)
  corners: CornerPoints
  filter: FilterMode
  dataUrl: string // recorte + filtro (vai para o PDF)
  width: number
  height: number
}

const CORNER_KEYS = [
  'topLeftCorner',
  'topRightCorner',
  'bottomRightCorner',
  'bottomLeftCorner',
] as const

const FILTER_OPTIONS = [
  { label: 'Cor', value: 'color' },
  { label: 'Cinza', value: 'gray' },
  { label: 'P&B', value: 'bw' },
] as const

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Cantos padrao (recuo de 8%) quando a deteccao automatica falha.
function defaultCorners(width: number, height: number): CornerPoints {
  const insetX = width * 0.08
  const insetY = height * 0.08
  return {
    topLeftCorner: { x: insetX, y: insetY },
    topRightCorner: { x: width - insetX, y: insetY },
    bottomRightCorner: { x: width - insetX, y: height - insetY },
    bottomLeftCorner: { x: insetX, y: height - insetY },
  }
}

// No iOS (todos os browsers usam WebKit) a camera nativa (input capture) entrega
// resolucao/foco superiores ao quadro do video — atalho util na revisao.
function isLikelyIOS(): boolean {
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

function loadCanvas(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Nao foi possivel ler a imagem.'))
        return
      }
      ctx.drawImage(image, 0, 0)
      resolve(canvas)
    }
    image.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'))
    image.src = src
  })
}

// Recorta pela perspectiva dos cantos e aplica o filtro, em resolucao cheia.
function renderCroppedPage(
  source: HTMLCanvasElement,
  corners: CornerPoints,
  filter: FilterMode,
  engineReady: boolean,
): { dataUrl: string; width: number; height: number } {
  const outWidth = Math.round(
    Math.max(
      distance(corners.topLeftCorner, corners.topRightCorner),
      distance(corners.bottomLeftCorner, corners.bottomRightCorner),
    ),
  )
  const outHeight = Math.round(
    Math.max(
      distance(corners.topLeftCorner, corners.bottomLeftCorner),
      distance(corners.topRightCorner, corners.bottomRightCorner),
    ),
  )

  let extracted: HTMLCanvasElement | null = null
  if (engineReady) {
    try {
      extracted = createScanner().extractPaper(
        source,
        outWidth || source.width,
        outHeight || source.height,
        corners,
      )
    } catch {
      extracted = null
    }
  }

  const filtered = enhanceWithFilter(extracted ?? source, filter)
  return {
    dataUrl: filtered.toDataURL('image/jpeg', 0.92),
    width: filtered.width,
    height: filtered.height,
  }
}

type Screen = 'camera' | 'review' | 'edit'

export function WebScannerDialog({
  open,
  onClose,
  onComplete,
  useMl = false,
}: WebScannerDialogProps) {
  const engineStatus = useScannerEngine(open)
  const engineReady = engineStatus === 'ready'

  // Detector DocAligner (IA): so carrega quando o provider e 'docaligner'.
  const { detector: mlDetector, status: mlStatus } = useDocAlignerDetector(
    open && useMl,
  )

  // Deteccao "melhor disponivel": tenta o DocAligner (se pronto); se ele nao
  // achar, cai no OpenCV/jscanify. Unico ponto de fallback do dialogo.
  const detectBest = useCallback(
    async (
      source: HTMLCanvasElement,
      opts: { fallback?: boolean },
    ): Promise<CornerPoints | null> => {
      if (mlDetector) {
        try {
          const ml = await mlDetector.detect(source, { fallback: false })
          if (ml) {
            return ml
          }
        } catch {
          // cai no OpenCV abaixo
        }
      }
      if (engineReady) {
        try {
          return detectCorners(createScanner(), source, opts)
        } catch {
          return null
        }
      }
      return null
    },
    [mlDetector, engineReady],
  )

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraBoxRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const pageIdRef = useRef(0)

  const [screen, setScreen] = useState<Screen>('camera')
  const [pages, setPages] = useState<ScannedPage[]>([])
  const [filter, setFilter] = useState<FilterMode>('color')
  const [error, setError] = useState('')

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [videoDim, setVideoDim] = useState<{ w: number; h: number } | null>(
    null,
  )
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null)
  const [liveCorners, setLiveCorners] = useState<CornerPoints | null>(null)

  // Edicao de uma pagina (recorte/filtro).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCanvas, setEditCanvas] = useState<HTMLCanvasElement | null>(null)
  const [editCorners, setEditCorners] = useState<CornerPoints | null>(null)
  const [editStep, setEditStep] = useState<'adjust' | 'preview'>('adjust')
  const [editPreviewUrl, setEditPreviewUrl] = useState('')
  const [editCroppedUrl, setEditCroppedUrl] = useState('')
  const [displayWidth, setDisplayWidth] = useState(0)
  const [dragging, setDragging] = useState<(typeof CORNER_KEYS)[number] | null>(
    null,
  )

  const fileInputId = useId()
  const preferNativeCapture = isLikelyIOS()

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    streamRef.current = null
  }, [])

  // Mede a area da camera com callback ref (em vez de um efeito): dispara quando
  // o <div> realmente monta — inclusive tardiamente, pelo portal do dialogo —
  // garantindo o boxSize ja no 1o open (antes, o efeito rodava cedo demais, com
  // a ref nula, e nao remedia ate trocar de tela; por isso a borda so aparecia
  // depois de ir as paginas e voltar).
  const boxObserverRef = useRef<ResizeObserver | null>(null)
  const measureCameraBox = useCallback((node: HTMLDivElement | null) => {
    cameraBoxRef.current = node
    boxObserverRef.current?.disconnect()
    boxObserverRef.current = null
    if (!node) {
      setBoxSize(null)
      return
    }
    const update = () =>
      setBoxSize({ w: node.clientWidth, h: node.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    boxObserverRef.current = observer
  }, [])

  // Adquire a camera na maior resolucao suportada pelo dispositivo. Para o stream
  // ao sair da tela de captura (revisao/edicao) para nao manter a camera ligada.
  useEffect(() => {
    if (!open || screen !== 'camera' || cameraFailed) {
      return
    }

    let active = true

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        })

        const track = stream.getVideoTracks()[0]
        try {
          const caps = track.getCapabilities?.()
          if (caps?.width?.max && caps?.height?.max) {
            await track.applyConstraints({
              width: caps.width.max,
              height: caps.height.max,
            })
          }
        } catch {
          // mantem a resolucao negociada inicialmente
        }

        if (!active) {
          stream.getTracks().forEach((t) => {
            t.stop()
          })
          return
        }

        streamRef.current = stream
        setCameraReady(true)
      } catch {
        setCameraFailed(true)
      }
    }

    start()

    return () => {
      active = false
      stopStream()
      setCameraReady(false)
      // Limpa as dimensoes/cantos do stream anterior para o overlay nao usar
      // valores defasados por 1-2 frames ao reabrir a camera.
      setVideoDim(null)
      setLiveCorners(null)
    }
  }, [open, screen, cameraFailed, stopStream])

  // Reanexa o stream ao elemento de video ao voltar para a camera.
  useEffect(() => {
    if (screen !== 'camera' || !cameraReady) {
      return
    }
    const video = videoRef.current
    if (video && streamRef.current) {
      video.srcObject = streamRef.current
      video.play().catch(() => undefined)
    }
  }, [screen, cameraReady])

  // Deteccao de borda ao vivo (throttle ~4fps, em quadro reduzido). A inferencia
  // pode ser assincrona (DocAligner), entao guardamos contra chamadas
  // concorrentes (`busy`) para nao acumular frames atrasados.
  useEffect(() => {
    if (screen !== 'camera' || !cameraReady || !(engineReady || mlDetector)) {
      setLiveCorners(null)
      return
    }

    const small = document.createElement('canvas')
    let stopped = false
    let busy = false
    // Segura a ultima borda detectada por um curto periodo: quedas momentaneas
    // (frame borrado ao mover a camera) nao apagam o overlay na hora, evitando
    // que a borda "pisque".
    let lastGoodAt = 0
    const HOLD_MS = 400

    const tick = async () => {
      if (stopped || busy) {
        return
      }
      const video = videoRef.current
      if (!video?.videoWidth) {
        return
      }
      busy = true
      try {
        const scale = 480 / Math.max(video.videoWidth, video.videoHeight)
        small.width = Math.round(video.videoWidth * scale)
        small.height = Math.round(video.videoHeight * scale)
        const ctx = small.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          return
        }
        ctx.drawImage(video, 0, 0, small.width, small.height)
        const detected = await detectBest(small, { fallback: false })
        if (stopped) {
          return
        }
        if (detected) {
          lastGoodAt = Date.now()
          const inv = 1 / scale
          setLiveCorners({
            topLeftCorner: scalePoint(detected.topLeftCorner, inv),
            topRightCorner: scalePoint(detected.topRightCorner, inv),
            bottomRightCorner: scalePoint(detected.bottomRightCorner, inv),
            bottomLeftCorner: scalePoint(detected.bottomLeftCorner, inv),
          })
        } else if (Date.now() - lastGoodAt > HOLD_MS) {
          // So apaga apos o periodo de "hold" sem nenhuma deteccao.
          setLiveCorners(null)
        }
      } catch {
        setLiveCorners(null)
      } finally {
        busy = false
      }
    }

    const interval = window.setInterval(() => void tick(), 250)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [screen, cameraReady, engineReady, mlDetector, detectBest])

  // Preview ao vivo do filtro na edicao (sobre a imagem inteira).
  useEffect(() => {
    if (screen !== 'edit' || editStep !== 'adjust' || !editCanvas) {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) {
        return
      }
      try {
        const filtered = enhanceWithFilter(downscale(editCanvas, 1400), filter)
        if (!cancelled) {
          setEditPreviewUrl(filtered.toDataURL('image/jpeg', 0.85))
        }
      } catch {
        if (!cancelled) {
          setEditPreviewUrl('')
        }
      }
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [screen, editStep, editCanvas, filter])

  // Sincroniza a largura exibida na edicao (para posicionar os cantos).
  useEffect(() => {
    if (screen !== 'edit' || editStep !== 'adjust') {
      return
    }
    const wrapper = wrapperRef.current
    if (!wrapper) {
      return
    }
    const update = () => setDisplayWidth(wrapper.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [screen, editStep])

  const resetAll = useCallback(() => {
    stopStream()
    setScreen('camera')
    setPages([])
    setFilter('color')
    setError('')
    setCameraReady(false)
    setCameraFailed(false)
    setVideoDim(null)
    setBoxSize(null)
    setLiveCorners(null)
    setEditingId(null)
    setEditCanvas(null)
    setEditCorners(null)
    setEditStep('adjust')
    setEditPreviewUrl('')
    setEditCroppedUrl('')
  }, [stopStream])

  // Limpa ao fechar.
  useEffect(() => {
    if (!open) {
      resetAll()
    }
  }, [open, resetAll])

  function handleClose() {
    stopStream()
    onClose()
  }

  async function addPageFromCanvas(canvas: HTMLCanvasElement) {
    const detected = await detectBest(canvas, { fallback: true })
    const corners = detected ?? defaultCorners(canvas.width, canvas.height)
    const rendered = renderCroppedPage(canvas, corners, filter, engineReady)

    pageIdRef.current += 1
    setPages((prev) => [
      ...prev,
      {
        id: `page-${pageIdRef.current}`,
        originalDataUrl: canvas.toDataURL('image/jpeg', 0.92),
        corners,
        filter,
        dataUrl: rendered.dataUrl,
        width: rendered.width,
        height: rendered.height,
      },
    ])
  }

  function handleShutter() {
    const video = videoRef.current
    if (!video?.videoWidth) {
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    void addPageFromCanvas(canvas)
  }

  async function handleFilesSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    if (!file) {
      return
    }
    try {
      const url = URL.createObjectURL(file)
      const canvas = await loadCanvas(url)
      URL.revokeObjectURL(url)
      await addPageFromCanvas(canvas)
      setScreen('review')
    } catch {
      setError('Nao foi possivel abrir a imagem selecionada.')
    }
  }

  async function openEdit(page: ScannedPage) {
    try {
      const canvas = await loadCanvas(page.originalDataUrl)
      setEditingId(page.id)
      setEditCanvas(canvas)
      setEditCorners(page.corners)
      setFilter(page.filter)
      setEditPreviewUrl('')
      setEditCroppedUrl('')
      setEditStep('adjust')
      setScreen('edit')
    } catch {
      setError('Nao foi possivel abrir a pagina para edicao.')
    }
  }

  function updateCorner(
    key: (typeof CORNER_KEYS)[number],
    clientX: number,
    clientY: number,
  ) {
    const wrapper = wrapperRef.current
    const source = editCanvas
    if (!wrapper || !source) {
      return
    }
    const rect = wrapper.getBoundingClientRect()
    const scale = source.width / rect.width
    const x = Math.min(Math.max((clientX - rect.left) * scale, 0), source.width)
    const y = Math.min(Math.max((clientY - rect.top) * scale, 0), source.height)
    setEditCorners((prev) => (prev ? { ...prev, [key]: { x, y } } : prev))
  }

  function handlePreviewCrop() {
    if (!editCanvas || !editCorners) {
      return
    }
    const rendered = renderCroppedPage(
      editCanvas,
      editCorners,
      filter,
      engineReady,
    )
    setEditCroppedUrl(rendered.dataUrl)
    setEditStep('preview')
  }

  function handleConfirmEdit() {
    if (!(editingId && editCanvas && editCorners)) {
      return
    }
    const rendered = renderCroppedPage(
      editCanvas,
      editCorners,
      filter,
      engineReady,
    )
    setPages((prev) =>
      prev.map((page) =>
        page.id === editingId
          ? {
              ...page,
              corners: editCorners,
              filter,
              dataUrl: rendered.dataUrl,
              width: rendered.width,
              height: rendered.height,
            }
          : page,
      ),
    )
    setScreen('review')
    setEditingId(null)
    setEditCanvas(null)
    setEditCorners(null)
    setEditCroppedUrl('')
    setEditPreviewUrl('')
    setEditStep('adjust')
  }

  function handleRemovePage(id: string) {
    setPages((prev) => prev.filter((page) => page.id !== id))
  }

  function handleFinish() {
    if (pages.length === 0) {
      return
    }
    try {
      const scanPages: ScanPage[] = pages.map((page) => ({
        dataUrl: page.dataUrl,
        width: page.width,
        height: page.height,
      }))
      const file = pagesToPdfFile(scanPages, buildScanFileName(new Date()))
      stopStream()
      onComplete(file)
    } catch (finishError) {
      setError(
        finishError instanceof Error
          ? finishError.message
          : 'Nao foi possivel gerar o PDF.',
      )
    }
  }

  const lastPage = pages.at(-1)
  const fit = computeFit(boxSize, videoDim)
  const editScale =
    editCanvas && displayWidth ? displayWidth / editCanvas.width : 1

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleClose()
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-black text-white outline-none">
          <DialogPrimitive.Title className="sr-only">
            Escanear documento
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Capture, ajuste e gere um PDF do documento.
          </DialogPrimitive.Description>

          {error ? (
            <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 mx-auto w-fit max-w-[90%] rounded-md bg-destructive px-3 py-2 text-center text-xs text-white">
              {error}
            </div>
          ) : null}

          {screen === 'camera' ? (
            <CameraScreen
              boxRef={measureCameraBox}
              cameraFailed={cameraFailed}
              cameraReady={cameraReady}
              engineStatus={engineStatus}
              mlStatus={useMl ? mlStatus : null}
              filter={filter}
              fit={fit}
              liveCorners={liveCorners}
              onClose={handleClose}
              onOpenNative={() => fileInputRef.current?.click()}
              onOpenReview={() => setScreen('review')}
              onShutter={handleShutter}
              pagesCount={pages.length}
              lastThumb={lastPage?.dataUrl}
              setFilter={setFilter}
              videoDim={videoDim}
              videoRef={videoRef}
              onVideoMeta={(w, h) => setVideoDim({ w, h })}
            />
          ) : null}

          {screen === 'review' ? (
            <ReviewScreen
              onAddMore={() => setScreen('camera')}
              onClose={handleClose}
              onEdit={openEdit}
              onFinish={handleFinish}
              onNativeCapture={() => fileInputRef.current?.click()}
              onRemove={handleRemovePage}
              pages={pages}
              preferNativeCapture={preferNativeCapture}
            />
          ) : null}

          {screen === 'edit' && editCanvas ? (
            <EditScreen
              corners={editCorners}
              croppedUrl={editCroppedUrl}
              dragging={dragging}
              editCanvas={editCanvas}
              filter={filter}
              onConfirm={handleConfirmEdit}
              onPreview={handlePreviewCrop}
              onBack={() => {
                setScreen('review')
                setEditingId(null)
              }}
              onBackToAdjust={() => {
                setEditCroppedUrl('')
                setEditStep('adjust')
              }}
              onPointerDownCorner={setDragging}
              onPointerUpCorner={() => setDragging(null)}
              onReset={() => {
                if (editCanvas) {
                  setEditCorners(
                    defaultCorners(editCanvas.width, editCanvas.height),
                  )
                }
              }}
              onSetDisplayWidth={setDisplayWidth}
              previewUrl={editPreviewUrl}
              scale={editScale}
              setFilter={setFilter}
              step={editStep}
              updateCorner={updateCorner}
              wrapperRef={wrapperRef}
            />
          ) : null}

          <input
            accept="image/*"
            capture="environment"
            className="hidden"
            id={fileInputId}
            onChange={handleFilesSelected}
            ref={fileInputRef}
            type="file"
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function scalePoint(p: { x: number; y: number }, factor: number) {
  return { x: p.x * factor, y: p.y * factor }
}

function downscale(
  source: HTMLCanvasElement,
  maxDimension: number,
): HTMLCanvasElement {
  const scale = Math.min(
    1,
    maxDimension / Math.max(source.width, source.height),
  )
  if (scale >= 1) {
    return source
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

// Caixa "contain" do video dentro do container (para alinhar o overlay).
function computeFit(
  box: { w: number; h: number } | null,
  video: { w: number; h: number } | null,
) {
  if (!box || !video || video.w === 0 || video.h === 0) {
    return null
  }
  const scale = Math.min(box.w / video.w, box.h / video.h)
  const width = video.w * scale
  const height = video.h * scale
  return {
    left: (box.w - width) / 2,
    top: (box.h - height) / 2,
    width,
    height,
  }
}

function FilterChips({
  filter,
  setFilter,
}: {
  filter: FilterMode
  setFilter: (f: FilterMode) => void
}) {
  return (
    <div className="flex justify-center gap-2">
      {FILTER_OPTIONS.map((option) => (
        <button
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition',
            filter === option.value
              ? 'bg-white text-black'
              : 'bg-white/15 text-white',
          )}
          key={option.value}
          onClick={() => setFilter(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CornerOverlay({
  corners,
  viewBox,
  style,
}: {
  corners: CornerPoints
  viewBox: string
  style: React.CSSProperties
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      preserveAspectRatio="none"
      style={style}
      viewBox={viewBox}
    >
      <polygon
        fill="rgba(56,132,255,0.15)"
        points={CORNER_KEYS.map((k) => `${corners[k].x},${corners[k].y}`).join(
          ' ',
        )}
        stroke="rgb(56,132,255)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

type CameraScreenProps = {
  boxRef: React.Ref<HTMLDivElement>
  cameraFailed: boolean
  cameraReady: boolean
  engineStatus: string
  mlStatus: DocAlignerStatus | null
  filter: FilterMode
  fit: { left: number; top: number; width: number; height: number } | null
  liveCorners: CornerPoints | null
  onClose: () => void
  onOpenNative: () => void
  onOpenReview: () => void
  onShutter: () => void
  pagesCount: number
  lastThumb?: string
  setFilter: (f: FilterMode) => void
  videoDim: { w: number; h: number } | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  onVideoMeta: (w: number, h: number) => void
}

function CameraScreen({
  boxRef,
  cameraFailed,
  cameraReady,
  engineStatus,
  mlStatus,
  filter,
  fit,
  liveCorners,
  onClose,
  onOpenNative,
  onOpenReview,
  onShutter,
  pagesCount,
  lastThumb,
  setFilter,
  videoDim,
  videoRef,
  onVideoMeta,
}: CameraScreenProps) {
  return (
    <>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <FilterChips filter={filter} setFilter={setFilter} />
      </div>

      <div className="relative flex-1 overflow-hidden" ref={boxRef}>
        {cameraFailed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-white/80">
              Nao foi possivel acessar a camera. Use a camera do sistema para
              tirar a foto.
            </p>
            <Button onClick={onOpenNative} type="button" variant="secondary">
              Tirar foto
            </Button>
          </div>
        ) : (
          <>
            <video
              autoPlay
              className="h-full w-full object-contain"
              muted
              onLoadedMetadata={(e) =>
                onVideoMeta(
                  e.currentTarget.videoWidth,
                  e.currentTarget.videoHeight,
                )
              }
              playsInline
              ref={videoRef}
            >
              <track kind="captions" />
            </video>
            {liveCorners && fit && videoDim ? (
              <CornerOverlay
                corners={liveCorners}
                style={{
                  left: fit.left,
                  top: fit.top,
                  width: fit.width,
                  height: fit.height,
                }}
                viewBox={`0 0 ${videoDim.w} ${videoDim.h}`}
              />
            ) : null}
            {!cameraReady ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                Iniciando camera...
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="z-10 flex items-center justify-between px-8 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <button
          aria-label="Cancelar"
          className="flex size-12 items-center justify-center rounded-full text-white"
          onClick={onClose}
          type="button"
        >
          <X className="size-6" />
        </button>

        <button
          aria-label="Capturar"
          className="flex size-18 items-center justify-center rounded-full ring-4 ring-white/80 disabled:opacity-40"
          disabled={!cameraReady}
          onClick={onShutter}
          type="button"
        >
          <span className="size-15 rounded-full bg-white" />
        </button>

        <button
          aria-label={`Revisar ${pagesCount} paginas`}
          className="flex size-12 items-center justify-center overflow-hidden rounded-lg border border-white/40 bg-white/10 disabled:opacity-30"
          disabled={pagesCount === 0}
          onClick={onOpenReview}
          type="button"
        >
          {lastThumb ? (
            <span className="relative block size-full">
              <img
                alt="Ultima pagina"
                className="size-full object-cover"
                src={lastThumb}
              />
              <span className="absolute -top-1.5 -right-1.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                {pagesCount}
              </span>
            </span>
          ) : (
            <ImageIcon className="size-5 text-white/70" />
          )}
        </button>
      </div>

      {mlStatus === 'loading' ? (
        <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+8rem)] text-center text-[11px] text-white/60">
          Carregando IA de deteccao de bordas...
        </p>
      ) : null}
      {mlStatus === 'ready' ? (
        <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+8rem)] text-center text-[11px] text-emerald-300/80">
          IA de bordas ativa
        </p>
      ) : null}
      {mlStatus === 'error' ? (
        <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+8rem)] text-center text-[11px] text-amber-300/90">
          IA indisponivel — usando deteccao padrao.
        </p>
      ) : null}
      {engineStatus === 'loading' ? (
        <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6rem)] text-center text-[11px] text-white/60">
          Carregando deteccao de bordas...
        </p>
      ) : null}
      {engineStatus === 'error' ? (
        <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6rem)] text-center text-[11px] text-amber-300/90">
          Deteccao de bordas indisponivel — ajuste os cantos manualmente.
        </p>
      ) : null}
    </>
  )
}

type ReviewScreenProps = {
  onAddMore: () => void
  onClose: () => void
  onEdit: (page: ScannedPage) => void
  onFinish: () => void
  onNativeCapture: () => void
  onRemove: (id: string) => void
  pages: ScannedPage[]
  preferNativeCapture: boolean
}

function ReviewScreen({
  onAddMore,
  onClose,
  onEdit,
  onFinish,
  onNativeCapture,
  onRemove,
  pages,
  preferNativeCapture,
}: ReviewScreenProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between border-b px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <button
          aria-label="Voltar para a camera"
          className="flex items-center gap-1 text-sm font-medium"
          onClick={onAddMore}
          type="button"
        >
          <ChevronLeft className="size-5" />
          Camera
        </button>
        <span className="text-sm font-semibold">{`${pages.length} ${pages.length === 1 ? 'pagina' : 'paginas'}`}</span>
        <button
          aria-label="Fechar"
          className="flex size-8 items-center justify-center rounded-full"
          onClick={onClose}
          type="button"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {pages.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Nenhuma pagina ainda. Volte para a camera e capture.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {pages.map((page, index) => (
              <div className="relative" key={page.id}>
                <button
                  className="block w-full overflow-hidden rounded-lg border border-border bg-card"
                  onClick={() => onEdit(page)}
                  type="button"
                >
                  <img
                    alt={`Pagina ${index + 1}`}
                    className="aspect-3/4 w-full object-cover"
                    src={page.dataUrl}
                  />
                </button>
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] font-medium text-white">
                  {index + 1}
                </span>
                <button
                  aria-label={`Remover pagina ${index + 1}`}
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-destructive text-white"
                  onClick={() => onRemove(page.id)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t bg-muted/40 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {preferNativeCapture ? (
          <Button onClick={onNativeCapture} type="button" variant="outline">
            Adicionar foto em alta resolucao
          </Button>
        ) : null}
        <Button disabled={pages.length === 0} onClick={onFinish} type="button">
          {`Anexar PDF (${pages.length})`}
        </Button>
      </div>
    </div>
  )
}

type EditScreenProps = {
  corners: CornerPoints | null
  croppedUrl: string
  dragging: (typeof CORNER_KEYS)[number] | null
  editCanvas: HTMLCanvasElement
  filter: FilterMode
  onBack: () => void
  onBackToAdjust: () => void
  onConfirm: () => void
  onPointerDownCorner: (k: (typeof CORNER_KEYS)[number]) => void
  onPointerUpCorner: () => void
  onPreview: () => void
  onReset: () => void
  onSetDisplayWidth: (w: number) => void
  previewUrl: string
  scale: number
  setFilter: (f: FilterMode) => void
  step: 'adjust' | 'preview'
  updateCorner: (
    k: (typeof CORNER_KEYS)[number],
    clientX: number,
    clientY: number,
  ) => void
  wrapperRef: React.RefObject<HTMLDivElement | null>
}

function EditScreen({
  corners,
  croppedUrl,
  dragging,
  editCanvas,
  filter,
  onBack,
  onBackToAdjust,
  onConfirm,
  onPointerDownCorner,
  onPointerUpCorner,
  onPreview,
  onReset,
  onSetDisplayWidth,
  previewUrl,
  scale,
  setFilter,
  step,
  updateCorner,
  wrapperRef,
}: EditScreenProps) {
  const capturedUrl =
    step === 'adjust'
      ? previewUrl || editCanvas.toDataURL('image/jpeg', 0.85)
      : ''

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between border-b px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <button
          aria-label="Voltar"
          className="flex items-center gap-1 text-sm font-medium"
          onClick={onBack}
          type="button"
        >
          <ChevronLeft className="size-5" />
          Paginas
        </button>
        <span className="text-sm font-semibold">
          {step === 'adjust' ? 'Ajustar bordas' : 'Revisar recorte'}
        </span>
        <span className="size-8" />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
        {step === 'adjust' ? (
          <div className="relative mx-auto w-full" ref={wrapperRef}>
            <img
              alt="Documento capturado"
              className="block h-auto w-full rounded-lg border border-border"
              onLoad={(e) => onSetDisplayWidth(e.currentTarget.clientWidth)}
              src={capturedUrl}
            />
            {corners ? (
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
                viewBox={`0 0 ${editCanvas.width} ${editCanvas.height}`}
              >
                <polygon
                  className="fill-primary/10 stroke-primary"
                  points={CORNER_KEYS.map(
                    (k) => `${corners[k].x},${corners[k].y}`,
                  ).join(' ')}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : null}
            {corners
              ? CORNER_KEYS.map((key) => {
                  const point = corners[key]
                  return (
                    <button
                      aria-label={`Ajustar canto ${key}`}
                      className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white bg-primary shadow-md"
                      key={key}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId)
                        onPointerDownCorner(key)
                      }}
                      onPointerMove={(e) => {
                        if (dragging === key) {
                          updateCorner(key, e.clientX, e.clientY)
                        }
                      }}
                      onPointerUp={onPointerUpCorner}
                      style={{ left: point.x * scale, top: point.y * scale }}
                      type="button"
                    />
                  )
                })
              : null}
          </div>
        ) : (
          <img
            alt="Pre-visualizacao do recorte"
            className="mx-auto block h-auto max-h-full w-auto rounded-lg border border-border"
            src={croppedUrl}
          />
        )}
      </div>

      <div className="shrink-0 border-t bg-muted/40 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {step === 'adjust' ? (
          <div className="flex flex-col gap-3">
            <FilterChipsLight filter={filter} setFilter={setFilter} />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={onReset}
                type="button"
                variant="outline"
              >
                Restaurar bordas
              </Button>
              <Button className="flex-1" onClick={onPreview} type="button">
                <Crop className="size-4" />
                Pre-visualizar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={onBackToAdjust}
              type="button"
              variant="outline"
            >
              <RotateCcw className="size-4" />
              Ajustar bordas
            </Button>
            <Button className="flex-1" onClick={onConfirm} type="button">
              <Check className="size-4" />
              Confirmar
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChipsLight({
  filter,
  setFilter,
}: {
  filter: FilterMode
  setFilter: (f: FilterMode) => void
}) {
  return (
    <div className="flex justify-center gap-2">
      {FILTER_OPTIONS.map((option) => (
        <Button
          key={option.value}
          onClick={() => setFilter(option.value)}
          size="sm"
          type="button"
          variant={filter === option.value ? 'default' : 'outline'}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
