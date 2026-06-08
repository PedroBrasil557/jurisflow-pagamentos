import { Camera, Check, RotateCcw, ScanLine, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
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
}

const CORNER_KEYS = [
  'topLeftCorner',
  'topRightCorner',
  'bottomRightCorner',
  'bottomLeftCorner',
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

export function WebScannerDialog({
  open,
  onClose,
  onComplete,
}: WebScannerDialogProps) {
  const engineStatus = useScannerEngine(open)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [mode, setMode] = useState<'capture' | 'edit'>('capture')
  const [captured, setCaptured] = useState<HTMLCanvasElement | null>(null)
  const [capturedUrl, setCapturedUrl] = useState('')
  const [corners, setCorners] = useState<CornerPoints | null>(null)
  const [displayWidth, setDisplayWidth] = useState(0)
  const [dragging, setDragging] = useState<(typeof CORNER_KEYS)[number] | null>(
    null,
  )
  const [filter, setFilter] = useState<FilterMode>('color')
  const [pages, setPages] = useState<Array<ScanPage & { id: string }>>([])
  const [error, setError] = useState('')
  const pageIdRef = useRef(0)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop()
    })
    streamRef.current = null
  }, [])

  // Adquire o stream uma unica vez enquanto o dialog estiver aberto e o para ao
  // fechar. Manter fora do ciclo de captura/edicao evita vazar streams.
  useEffect(() => {
    if (!open || cameraFailed) {
      return
    }

    let active = true

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        if (!active) {
          stream.getTracks().forEach((track) => {
            track.stop()
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
    }
  }, [open, cameraFailed, stopStream])

  // Reanexa o stream ao elemento de video sempre que voltamos ao modo captura.
  useEffect(() => {
    if (mode !== 'capture' || !cameraReady) {
      return
    }

    const video = videoRef.current

    if (video && streamRef.current) {
      video.srcObject = streamRef.current
      video.play().catch(() => undefined)
    }
  }, [mode, cameraReady])

  // Mantem displayWidth em sincronia com o tamanho real exibido (rotacao/resize).
  useEffect(() => {
    if (mode !== 'edit') {
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
  }, [mode])

  // Limpa tudo ao fechar.
  useEffect(() => {
    if (open) {
      return
    }

    stopStream()
    setCameraReady(false)
    setCameraFailed(false)
    setMode('capture')
    setCaptured(null)
    setCapturedUrl('')
    setCorners(null)
    setFilter('color')
    setPages([])
    setError('')
  }, [open, stopStream])

  function detectAndEnterEdit(canvas: HTMLCanvasElement) {
    let detected: CornerPoints | null = null

    if (engineStatus === 'ready') {
      try {
        detected = detectCorners(createScanner(), canvas)
      } catch {
        detected = null
      }
    }

    setCaptured(canvas)
    setCapturedUrl(canvas.toDataURL('image/jpeg', 0.9))
    setCorners(detected ?? defaultCorners(canvas.width, canvas.height))
    setMode('edit')
  }

  function handleCapture() {
    const video = videoRef.current

    if (!video || !video.videoWidth) {
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
    detectAndEnterEdit(canvas)
  }

  function loadCanvasFromFile(file: File): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const image = new Image()
      const url = URL.createObjectURL(file)

      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')
        URL.revokeObjectURL(url)

        if (!ctx) {
          reject(new Error('Nao foi possivel ler a imagem.'))
          return
        }

        ctx.drawImage(image, 0, 0)
        resolve(canvas)
      }

      image.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Nao foi possivel ler a imagem.'))
      }

      image.src = url
    })
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
      const canvas = await loadCanvasFromFile(file)
      detectAndEnterEdit(canvas)
    } catch {
      setError('Nao foi possivel abrir a imagem selecionada.')
    }
  }

  function updateCorner(
    key: (typeof CORNER_KEYS)[number],
    clientX: number,
    clientY: number,
  ) {
    const wrapper = wrapperRef.current
    const source = captured

    if (!wrapper || !source) {
      return
    }

    const rect = wrapper.getBoundingClientRect()
    const scale = source.width / rect.width
    const x = Math.min(Math.max((clientX - rect.left) * scale, 0), source.width)
    const y = Math.min(Math.max((clientY - rect.top) * scale, 0), source.height)

    setCorners((prev) => (prev ? { ...prev, [key]: { x, y } } : prev))
  }

  function handleConfirmPage() {
    if (!captured || !corners) {
      return
    }

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

    if (engineStatus === 'ready') {
      try {
        extracted = createScanner().extractPaper(
          captured,
          outWidth || captured.width,
          outHeight || captured.height,
          corners,
        )
      } catch {
        extracted = null
      }
    }

    const filtered = enhanceWithFilter(extracted ?? captured, filter)
    const dataUrl = filtered.toDataURL('image/jpeg', 0.92)

    pageIdRef.current += 1
    setPages((prev) => [
      ...prev,
      {
        id: `page-${pageIdRef.current}`,
        dataUrl,
        width: filtered.width,
        height: filtered.height,
      },
    ])
    setCaptured(null)
    setCapturedUrl('')
    setCorners(null)
    setMode('capture')
  }

  function handleDiscardCapture() {
    setCaptured(null)
    setCapturedUrl('')
    setCorners(null)
    setMode('capture')
  }

  function handleRemovePage(index: number) {
    setPages((prev) => prev.filter((_, i) => i !== index))
  }

  function handleFinish() {
    if (pages.length === 0) {
      return
    }

    try {
      const file = pagesToPdfFile(pages, buildScanFileName(new Date()))
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

  const scale = captured && displayWidth ? displayWidth / captured.width : 1

  return (
    <AppDialog
      description="Bata a foto, ajuste os cantos e gere um PDF do documento."
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={pages.length === 0}
            onClick={handleFinish}
            type="button"
          >
            {`Anexar PDF (${pages.length})`}
          </Button>
        </>
      }
      icon={ScanLine}
      maxWidth="2xl"
      onClose={onClose}
      open={open}
      title="Escanear documento"
      variant="info"
    >
      <div className="grid gap-4">
        {mode === 'capture' ? (
          <div className="grid gap-3">
            {cameraFailed ? (
              <div className="grid gap-3 rounded-2xl border border-dashed border-border bg-muted/35 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Nao foi possivel acessar a camera. Use a opcao abaixo para
                  tirar uma foto ou enviar uma imagem.
                </p>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                  variant="outline"
                >
                  <Camera className="size-4" />
                  Tirar foto ou enviar imagem
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="overflow-hidden rounded-2xl border border-border bg-black">
                  <video className="h-auto w-full" playsInline ref={videoRef}>
                    <track kind="captions" />
                  </video>
                </div>
                <Button
                  disabled={!cameraReady}
                  onClick={handleCapture}
                  type="button"
                >
                  <Camera className="size-4" />
                  {cameraReady ? 'Capturar' : 'Iniciando camera...'}
                </Button>
              </div>
            )}

            {engineStatus === 'loading' ? (
              <p className="text-xs text-muted-foreground">
                Carregando motor de digitalizacao...
              </p>
            ) : null}
            {engineStatus === 'error' ? (
              <p className="text-xs text-muted-foreground">
                Ajuste automatico de bordas indisponivel. Voce ainda pode
                ajustar os cantos manualmente.
              </p>
            ) : null}
          </div>
        ) : null}

        {mode === 'edit' && captured ? (
          <div className="grid gap-3">
            <div className="relative mx-auto w-full" ref={wrapperRef}>
              <img
                alt="Documento capturado"
                className="block h-auto w-full rounded-2xl border border-border"
                onLoad={(event) =>
                  setDisplayWidth(event.currentTarget.clientWidth)
                }
                src={capturedUrl}
              />
              {corners
                ? CORNER_KEYS.map((key) => {
                    const point = corners[key]

                    return (
                      <button
                        aria-label={`Ajustar canto ${key}`}
                        className="absolute size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white bg-primary shadow-md"
                        key={key}
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId)
                          setDragging(key)
                        }}
                        onPointerMove={(event) => {
                          if (dragging === key) {
                            updateCorner(key, event.clientX, event.clientY)
                          }
                        }}
                        onPointerUp={() => setDragging(null)}
                        style={{
                          left: point.x * scale,
                          top: point.y * scale,
                        }}
                        type="button"
                      />
                    )
                  })
                : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  { label: 'Cor', value: 'color' },
                  { label: 'Tons de cinza', value: 'gray' },
                  { label: 'Preto e branco', value: 'bw' },
                ] as const
              ).map((option) => (
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

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                onClick={handleDiscardCapture}
                type="button"
                variant="ghost"
              >
                <RotateCcw className="size-4" />
                Refazer
              </Button>
              <Button onClick={handleConfirmPage} type="button">
                <Check className="size-4" />
                Confirmar pagina
              </Button>
            </div>
          </div>
        ) : null}

        {pages.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              {`Paginas (${pages.length})`}
            </p>
            <div className="flex flex-wrap gap-3">
              {pages.map((page, index) => (
                <div
                  className="relative size-20 overflow-hidden rounded-lg border border-border"
                  key={page.id}
                >
                  <img
                    alt={`Pagina ${index + 1}`}
                    className="size-full object-cover"
                    src={page.dataUrl}
                  />
                  <button
                    aria-label={`Remover pagina ${index + 1}`}
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-white"
                    onClick={() => handleRemovePage(index)}
                    type="button"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <input
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFilesSelected}
          ref={fileInputRef}
          type="file"
        />
      </div>
    </AppDialog>
  )
}
