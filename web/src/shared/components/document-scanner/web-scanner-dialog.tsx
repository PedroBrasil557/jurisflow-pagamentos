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
import {
  canvasToJpegBlob,
  decodeToWorkingCanvas,
  downscaleCanvasToLongEdge,
  releaseCanvas,
} from './image-normalize'
import { enhanceWithFilter, type FilterMode } from './scan-enhance'
import {
  clearScanSession,
  deleteScanPage,
  loadPendingScanSession,
  type StoredScanPage,
  saveScanPage,
} from './scan-session-store'
import { buildScanFileName, pagesToPdfFile, type ScanPage } from './scan-to-pdf'
import { warpPerspectiveToCanvas } from './scan-warp'
import type { CornerPoints } from './scanner-engine'

type WebScannerDialogProps = {
  open: boolean
  onClose: () => void
  // scanSessionId: id da sessao de captura (IndexedDB) para o uploader limpar
  // APOS o upload confirmar. null quando nao ha sessao persistida (ex.: Scanbot).
  onComplete: (file: File, scanSessionId: string | null) => void
}

type ScannedPage = {
  id: string
  sortOrder: number // ordem de captura; chave de ordenacao no IndexedDB
  // Imagem NORMALIZADA (<=300 DPI) do quadro, para reeditar. Blob (disco/heap
  // gerido pelo browser), nao dataUrl base64 — mantem o heap baixo.
  originalBlob: Blob
  corners: CornerPoints
  filter: FilterMode
  blob: Blob // recorte + filtro (vai para o PDF e para o IndexedDB)
  thumbUrl: string // object URL de `blob`, para a tira de revisao
  width: number
  height: number
}

// Teto de paginas por digitalizacao. Acima disso o PDF de imagens tende a
// estourar limites da extracao por IA (tokens de saida / tamanho do payload
// base64), causando dead-letter deterministico sem acao para o usuario. Manter
// abaixo desse ponto e a prevencao na origem.
const MAX_SCAN_PAGES = 15

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

// Cantos do quadro inteiro (recorte identidade). Usado em paginas recuperadas: a
// imagem persistida JA e o recorte final, entao reeditar com estes cantos nao
// recorta de novo (sem crop duplo); o usuario ainda pode arrastar para ajustar.
function fullFrameCorners(width: number, height: number): CornerPoints {
  return {
    topLeftCorner: { x: 0, y: 0 },
    topRightCorner: { x: width, y: 0 },
    bottomRightCorner: { x: width, y: height },
    bottomLeftCorner: { x: 0, y: height },
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

// Recorta pela perspectiva dos cantos e aplica o filtro. Opera sobre a imagem JA
// NORMALIZADA (<=300 DPI) — devolve o canvas resultante (o chamador converte em
// Blob, sem passar por dataUrl base64).
function renderCroppedPage(
  source: HTMLCanvasElement,
  corners: CornerPoints,
  filter: FilterMode,
): { canvas: HTMLCanvasElement; width: number; height: number } {
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

  // Recorte + deskew por WebGL (substitui o warpPerspective do OpenCV). Sem WebGL
  // ou em falha, warpPerspectiveToCanvas devolve a fonte nao recortada.
  const extracted = warpPerspectiveToCanvas(
    source,
    corners,
    outWidth || source.width,
    outHeight || source.height,
  )

  const filtered = enhanceWithFilter(extracted, filter)
  return {
    canvas: filtered,
    width: filtered.width,
    height: filtered.height,
  }
}

// Le um Blob para um dataUrl (usado so em momentos pontuais: preview da edicao e
// montagem final do PDF — nunca para reter paginas no estado).
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'))
    reader.readAsDataURL(blob)
  })
}

type Screen = 'camera' | 'review' | 'edit'

// Vibracao curta de confirmacao ao capturar (Web Vibration API). Suportada no
// Android; iOS Safari nao implementa navigator.vibrate (sem efeito la).
function hapticTap() {
  try {
    navigator.vibrate?.(40)
  } catch {
    // sem suporte ou bloqueado por policy — ignora.
  }
}

export function WebScannerDialog({
  open,
  onClose,
  onComplete,
}: WebScannerDialogProps) {
  // Detector DocAligner (IA): unico motor de deteccao no navegador. Se a IA nao
  // achar os cantos (ou o modelo nao carregar), o usuario ajusta manualmente.
  const { detector: mlDetector, status: mlStatus } = useDocAlignerDetector(open)

  const detectBest = useCallback(
    async (source: HTMLCanvasElement): Promise<CornerPoints | null> => {
      if (!mlDetector) {
        return null
      }
      try {
        return await mlDetector.detect(source, { fallback: false })
      } catch {
        return null
      }
    },
    [mlDetector],
  )

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const pageIdRef = useRef(0)
  // Id da sessao de captura (cliente). Chaveia as paginas persistidas em
  // IndexedDB — durabilidade contra tab-kill. Criado na 1a captura (lazy).
  const sessionIdRef = useRef<string>('')
  // Espelho de `pages` para revogar os object URLs no cleanup sem re-derivar o
  // callback a cada pagina.
  const pagesRef = useRef<ScannedPage[]>([])

  const [screen, setScreen] = useState<Screen>('camera')
  const [pages, setPages] = useState<ScannedPage[]>([])
  // Sessao pendente recuperavel (tab-kill/recarga): paginas achadas no IndexedDB.
  const [recoverable, setRecoverable] = useState<{
    sessionId: string
    pages: StoredScanPage[]
  } | null>(null)
  const [filter, setFilter] = useState<FilterMode>('color')
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(false)
  // Captura em voo: addPageFromCanvas faz um await (deteccao ~200-400ms) ANTES de
  // inserir a pagina em `pages`. O guard impede (a) duplo-toque no shutter e (b)
  // finalizar o PDF antes da pagina entrar — que dropava a ultima pagina
  // silenciosamente. O ref e a trava sincrona; o state desabilita os botoes.
  const [capturing, setCapturing] = useState(false)
  const capturingRef = useRef(false)

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
    if (screen !== 'camera' || !cameraReady || !mlDetector) {
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
      // Gate cruzado com a captura: a inferencia da IA (worker ONNX) nao deve
      // rodar concorrente consigo mesma. Se a captura esta detectando, ou o tick
      // anterior ainda roda, pula este tick.
      if (stopped || busy || capturingRef.current) {
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
        const detected = await detectBest(small)
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
  }, [screen, cameraReady, mlDetector, detectBest])

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

  // Mantem o espelho de paginas atualizado (para revogar object URLs no cleanup).
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  const resetAll = useCallback(() => {
    stopStream()
    // Revoga os object URLs das miniaturas (evita vazamento).
    for (const page of pagesRef.current) {
      URL.revokeObjectURL(page.thumbUrl)
    }
    pagesRef.current = []
    sessionIdRef.current = ''
    pageIdRef.current = 0
    setScreen('camera')
    setPages([])
    setFilter('color')
    setError('')
    setFlash(false)
    setCameraReady(false)
    setCameraFailed(false)
    setVideoDim(null)
    setBoxSize(null)
    setLiveCorners(null)
    setRecoverable(null)
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

  // Durabilidade: ao abrir, procura uma sessao pendente (tab-kill/recarga) e
  // varre sessoes velhas por TTL. Se houver paginas, oferece recuperacao.
  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    loadPendingScanSession().then((pending) => {
      if (!cancelled && pending) {
        setRecoverable(pending)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open])

  function handleClose() {
    // Fechar (X / Esc / gesto-voltar / clique-fora) PRESERVA a sessao no
    // IndexedDB — um fechamento acidental na revisao nao deve destruir as
    // paginas. A limpeza ocorre em: sucesso do upload (na action), descarte
    // EXPLICITO (handleDiscardAll) e TTL. Reabrir oferece recuperar.
    stopStream()
    onClose()
  }

  // Descarte EXPLICITO (botao dedicado): apaga a sessao duravel e fecha.
  function handleDiscardAll() {
    if (sessionIdRef.current) {
      void clearScanSession(sessionIdRef.current)
    }
    stopStream()
    onClose()
  }

  // Recupera a sessao pendente: reconstroi as paginas a partir dos Blobs no
  // IndexedDB (miniaturas via object URL) e retoma na revisao.
  function handleRecoverSession() {
    if (!recoverable) {
      return
    }
    sessionIdRef.current = recoverable.sessionId
    let maxOrder = 0
    const restored: ScannedPage[] = recoverable.pages.map((stored) => {
      maxOrder = Math.max(maxOrder, stored.sortOrder)
      return {
        id: stored.id,
        sortOrder: stored.sortOrder,
        // A imagem persistida ja e o recorte final; cantos de quadro cheio evitam
        // recorte duplo se o usuario reabrir a edicao.
        originalBlob: stored.blob,
        corners: fullFrameCorners(stored.width, stored.height),
        filter: 'color',
        blob: stored.blob,
        thumbUrl: URL.createObjectURL(stored.blob),
        width: stored.width,
        height: stored.height,
      }
    })
    pageIdRef.current = maxOrder
    setPages(restored)
    setRecoverable(null)
    setScreen('review')
  }

  function handleDiscardRecovery() {
    if (recoverable) {
      void clearScanSession(recoverable.sessionId)
    }
    setRecoverable(null)
  }

  async function addPageFromCanvas(sourceCanvas: HTMLCanvasElement) {
    // Teto de paginas (previne dead-letter por documento grande demais na IA).
    if (pagesRef.current.length >= MAX_SCAN_PAGES) {
      setError(
        `Limite de ${MAX_SCAN_PAGES} paginas por digitalizacao. Finalize e escaneie o restante em outro documento.`,
      )
      return
    }
    capturingRef.current = true
    setCapturing(true)
    try {
      // 1o passo (critico para memoria): normaliza a <=300 DPI ANTES de detectar/
      // recortar. A IA e o warp WebGL rodam sobre a imagem normalizada — nunca uma
      // imagem de 50 MP.
      const work = downscaleCanvasToLongEdge(sourceCanvas)
      const detected = await detectBest(work)
      const corners = detected ?? defaultCorners(work.width, work.height)
      const rendered = renderCroppedPage(work, corners, filter)

      // Blobs (fora do heap de strings), nao dataUrl base64.
      const originalBlob = await canvasToJpegBlob(work)
      const blob = await canvasToJpegBlob(rendered.canvas)
      releaseCanvas(rendered.canvas)
      if (work !== sourceCanvas) {
        releaseCanvas(work)
      }
      releaseCanvas(sourceCanvas)

      if (!sessionIdRef.current) {
        sessionIdRef.current = crypto.randomUUID()
      }
      pageIdRef.current += 1
      const id = `page-${pageIdRef.current}`
      const sortOrder = pageIdRef.current
      const thumbUrl = URL.createObjectURL(blob)
      setPages((prev) => [
        ...prev,
        {
          id,
          sortOrder,
          originalBlob,
          corners,
          filter,
          blob,
          thumbUrl,
          width: rendered.width,
          height: rendered.height,
        },
      ])

      // Durabilidade: persiste a pagina em IndexedDB (best-effort). Se a aba
      // morrer, a sessao pode ser recuperada ao reabrir.
      void saveScanPage({
        id,
        sessionId: sessionIdRef.current,
        sortOrder,
        blob,
        width: rendered.width,
        height: rendered.height,
        createdAt: Date.now(),
      })
    } finally {
      capturingRef.current = false
      setCapturing(false)
    }
  }

  function handleShutter() {
    const video = videoRef.current
    if (!video?.videoWidth) {
      return
    }
    // Captura ainda em voo: ignora o toque (evita pagina duplicada).
    if (capturingRef.current) {
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
    hapticTap()
    // Flash visual de confirmacao (funciona em qualquer aparelho, iPhone
    // incluso, onde a vibracao nao existe).
    setFlash(true)
    window.setTimeout(() => setFlash(false), 130)
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
      // Decodifica JA REDUZIDO (createImageBitmap com resize) — nao materializa
      // os 50 MP da camera nativa num canvas de ~200 MB.
      const canvas = await decodeToWorkingCanvas(file)
      await addPageFromCanvas(canvas)
      setScreen('review')
    } catch {
      setError('Nao foi possivel abrir a imagem selecionada.')
    }
  }

  async function openEdit(page: ScannedPage) {
    try {
      const canvas = await decodeToWorkingCanvas(page.originalBlob)
      if (editCanvas) {
        releaseCanvas(editCanvas) // libera o canvas de uma edicao anterior
      }
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
    const rendered = renderCroppedPage(editCanvas, editCorners, filter)
    // Preview transitorio de uma imagem so — dataUrl e aceitavel aqui.
    setEditCroppedUrl(rendered.canvas.toDataURL('image/jpeg', 0.85))
    releaseCanvas(rendered.canvas)
    setEditStep('preview')
  }

  async function handleConfirmEdit() {
    if (!(editingId && editCanvas && editCorners)) {
      return
    }
    const rendered = renderCroppedPage(editCanvas, editCorners, filter)
    const blob = await canvasToJpegBlob(rendered.canvas)
    releaseCanvas(rendered.canvas)
    const thumbUrl = URL.createObjectURL(blob)
    const editedId = editingId
    const editedPage = pages.find((page) => page.id === editedId)
    setPages((prev) =>
      prev.map((page) => {
        if (page.id !== editedId) {
          return page
        }
        URL.revokeObjectURL(page.thumbUrl) // libera o object URL antigo
        return {
          ...page,
          corners: editCorners,
          filter,
          blob,
          thumbUrl,
          width: rendered.width,
          height: rendered.height,
        }
      }),
    )
    // Atualiza a copia duravel (mesmo id/sortOrder — carregado da propria pagina).
    if (sessionIdRef.current && editedPage) {
      void saveScanPage({
        id: editedId,
        sessionId: sessionIdRef.current,
        sortOrder: editedPage.sortOrder,
        blob,
        width: rendered.width,
        height: rendered.height,
        createdAt: Date.now(),
      })
    }
    releaseCanvas(editCanvas) // libera o canvas de trabalho da edicao
    setScreen('review')
    setEditingId(null)
    setEditCanvas(null)
    setEditCorners(null)
    setEditCroppedUrl('')
    setEditPreviewUrl('')
    setEditStep('adjust')
  }

  function handleRemovePage(id: string) {
    setPages((prev) => {
      const target = prev.find((page) => page.id === id)
      if (target) {
        URL.revokeObjectURL(target.thumbUrl)
      }
      return prev.filter((page) => page.id !== id)
    })
    void deleteScanPage(id)
  }

  async function handleFinish() {
    if (pages.length === 0) {
      return
    }
    // Ha captura em voo: a pagina ainda nao entrou em `pages`. Bloqueia para nao
    // gerar o PDF sem ela (o botao tambem fica desabilitado enquanto capturing).
    if (capturingRef.current) {
      return
    }
    try {
      // Converte cada Blob (pequeno, normalizado) em dataUrl JUST-IN-TIME para o
      // jsPDF — pico transitorio no finalizar, nao retencao ao longo da sessao.
      const scanPages: ScanPage[] = await Promise.all(
        pages.map(async (page) => ({
          dataUrl: await blobToDataUrl(page.blob),
          width: page.width,
          height: page.height,
        })),
      )
      const file = pagesToPdfFile(scanPages, buildScanFileName(new Date()))
      stopStream()
      // NAO limpa o IndexedDB aqui: o upload acontece depois (no parent) e pode
      // falhar em rede movel — a sessao duravel precisa sobreviver a isso. O
      // uploader limpa via `scanSessionId` APOS o upload confirmar. Fechar/cancelar
      // (handleClose) e o TTL cobrem os demais casos.
      onComplete(file, sessionIdRef.current || null)
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

          {recoverable ? (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 px-6">
              <div className="w-full max-w-sm rounded-xl bg-background p-5 text-foreground shadow-xl">
                <h2 className="text-base font-semibold">
                  Recuperar digitalizacao?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {`Encontramos ${recoverable.pages.length} ${recoverable.pages.length === 1 ? 'pagina' : 'paginas'} de uma sessao anterior que nao foi concluida.`}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={handleDiscardRecovery}
                    type="button"
                    variant="outline"
                  >
                    Descartar
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleRecoverSession}
                    type="button"
                  >
                    Recuperar
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {screen === 'camera' ? (
            <CameraScreen
              boxRef={measureCameraBox}
              cameraFailed={cameraFailed}
              cameraReady={cameraReady}
              capturing={capturing}
              mlStatus={mlStatus}
              filter={filter}
              fit={fit}
              liveCorners={liveCorners}
              onClose={handleClose}
              onOpenNative={() => fileInputRef.current?.click()}
              onOpenReview={() => setScreen('review')}
              onShutter={handleShutter}
              pagesCount={pages.length}
              lastThumb={lastPage?.thumbUrl}
              setFilter={setFilter}
              videoDim={videoDim}
              videoRef={videoRef}
              onVideoMeta={(w, h) => setVideoDim({ w, h })}
            />
          ) : null}

          {screen === 'review' ? (
            <ReviewScreen
              capturing={capturing}
              onAddMore={() => setScreen('camera')}
              onClose={handleClose}
              onEdit={openEdit}
              onDiscardAll={handleDiscardAll}
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

          {flash ? (
            <div className="pointer-events-none absolute inset-0 z-40 bg-white" />
          ) : null}
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
  capturing: boolean
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
  capturing,
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
          disabled={!cameraReady || capturing}
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
              <span className="absolute top-0.5 right-0.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white shadow ring-1 ring-white/60">
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
      {mlStatus === 'error' ? (
        <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+8rem)] text-center text-[11px] text-amber-300/90">
          Deteccao automatica indisponivel — ajuste os cantos manualmente.
        </p>
      ) : null}
    </>
  )
}

type ReviewScreenProps = {
  capturing: boolean
  onAddMore: () => void
  onClose: () => void
  onDiscardAll: () => void
  onEdit: (page: ScannedPage) => void
  onFinish: () => void
  onNativeCapture: () => void
  onRemove: (id: string) => void
  pages: ScannedPage[]
  preferNativeCapture: boolean
}

function ReviewScreen({
  capturing,
  onAddMore,
  onClose,
  onDiscardAll,
  onEdit,
  onFinish,
  onNativeCapture,
  onRemove,
  pages,
  preferNativeCapture,
}: ReviewScreenProps) {
  // Descarte exige confirmacao em dois toques (evita apagar tudo por engano).
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
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
                    src={page.thumbUrl}
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
        <Button
          disabled={pages.length === 0 || capturing}
          onClick={onFinish}
          type="button"
        >
          {`Anexar PDF (${pages.length})`}
        </Button>
        {pages.length > 0 ? (
          confirmingDiscard ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2">
              <span className="text-xs text-destructive">
                {`Descartar ${pages.length} ${pages.length === 1 ? 'pagina' : 'paginas'}?`}
              </span>
              <div className="flex gap-2">
                <Button
                  onClick={() => setConfirmingDiscard(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={onDiscardAll}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  Descartar
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setConfirmingDiscard(true)}
              type="button"
            >
              Descartar digitalizacao
            </button>
          )
        ) : null}
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
