'use client'

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

// Worker do pdfjs servido pelo proprio Vite (padrao new URL(..., import.meta.url)).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.15
// Folga p/ a pagina nao encostar nas bordas do container.
const PAD = 32
// Proporcao A4 retrato (largura/altura) como palpite ate a pagina carregar.
const A4_ASPECT = 210 / 297

type FitMode = 'page' | 'width'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round2 = (n: number) => Math.round(n * 100) / 100

type PdfViewerProps = {
  url: string
  className?: string
}

export function PdfViewer({ url, className }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  // fitMode = base do dimensionamento; zoom = multiplicador por cima (roda/botoes).
  const [fitMode, setFitMode] = useState<FitMode>('page')
  const [zoom, setZoom] = useState(1)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [aspect, setAspect] = useState(A4_ASPECT) // largura/altura da pagina
  const [error, setError] = useState(false)

  // Objeto `file` estavel: evita o react-pdf refazer o fetch a cada render.
  // Sem withCredentials: a URL e pre-assinada (a autorizacao vai na propria URL)
  // e o fetch com credenciais falharia no CORS do S3/MinIO.
  const file = useMemo(() => ({ url }), [url])

  // Mede o container (base do ajuste a largura/pagina).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setSize({ width: r.width, height: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Zoom pela RODA DO MOUSE. Listener nativo non-passive (React torna o onWheel
  // passivo e o preventDefault nao funcionaria).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const dir = e.deltaY < 0 ? 1 : -1
      setZoom((z) => clamp(round2(z + dir * ZOOM_STEP), MIN_ZOOM, MAX_ZOOM))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Largura base: 'width' preenche a largura; 'page' cabe a pagina INTEIRA na
  // area visivel (limita pela altura tambem) — default, evita texto gigante.
  const availW = Math.max(1, size.width - PAD)
  const availH = Math.max(1, size.height - PAD)
  const baseWidth =
    fitMode === 'width' ? availW : Math.min(availW, availH * aspect)
  const pageWidth = Math.max(1, baseWidth * zoom)

  function setFit(mode: FitMode) {
    setFitMode(mode)
    setZoom(1)
  }
  const zoomIn = () => setZoom((z) => clamp(round2(z + ZOOM_STEP), MIN_ZOOM, MAX_ZOOM))
  const zoomOut = () =>
    setZoom((z) => clamp(round2(z - ZOOM_STEP), MIN_ZOOM, MAX_ZOOM))

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            aria-label="Pagina anterior"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
            {numPages ? `${pageNumber} / ${numPages}` : '—'}
          </span>
          <Button
            aria-label="Proxima pagina"
            disabled={pageNumber >= numPages}
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            onClick={() => setFit('page')}
            size="sm"
            type="button"
            variant={fitMode === 'page' && zoom === 1 ? 'default' : 'outline'}
          >
            Pagina
          </Button>
          <Button
            onClick={() => setFit('width')}
            size="sm"
            type="button"
            variant={fitMode === 'width' && zoom === 1 ? 'default' : 'outline'}
          >
            Largura
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            aria-label="Diminuir zoom"
            disabled={zoom <= MIN_ZOOM}
            onClick={zoomOut}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            aria-label="Aumentar zoom"
            disabled={zoom >= MAX_ZOOM}
            onClick={zoomIn}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {/* Area do PDF (rola quando ampliado; a roda do mouse controla o zoom) */}
      <div className="flex-1 overflow-auto bg-muted/40 p-4" ref={scrollRef}>
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nao foi possivel carregar o documento.
          </div>
        ) : (
          <Document
            file={file}
            loading={
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            }
            onLoadError={() => setError(true)}
            onLoadSuccess={({ numPages: n }) => {
              setNumPages(n)
              setPageNumber((p) => Math.min(p, n))
            }}
          >
            {size.width > 0 ? (
              <div className="flex justify-center">
                <Page
                  className="shadow-md"
                  onLoadSuccess={(page) => {
                    if (page.originalHeight > 0) {
                      setAspect(page.originalWidth / page.originalHeight)
                    }
                  }}
                  pageNumber={pageNumber}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  width={pageWidth}
                />
              </div>
            ) : null}
          </Document>
        )}
      </div>
    </div>
  )
}
