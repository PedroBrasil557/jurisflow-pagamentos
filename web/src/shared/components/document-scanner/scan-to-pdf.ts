import { jsPDF } from 'jspdf'

// Limite de upload da plataforma (checklist e lote aceitam ate 25 MB por arquivo).
export const MAX_PDF_BYTES = 25 * 1024 * 1024

// Dimensoes de uma pagina A4 em pontos (unidade padrao do PDF).
const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89

export type ScanPage = {
  // Data URL de imagem JPEG (ex.: canvas.toDataURL('image/jpeg', 0.8)).
  dataUrl: string
  width: number
  height: number
}

export type PageLayout = {
  orientation: 'portrait' | 'landscape'
  pageWidth: number
  pageHeight: number
  imageWidth: number
  imageHeight: number
  offsetX: number
  offsetY: number
}

// Encaixa uma imagem WxH numa pagina A4 mantendo proporcao e centralizando.
export function computePageLayout(
  imageWidth: number,
  imageHeight: number,
): PageLayout {
  const orientation = imageWidth > imageHeight ? 'landscape' : 'portrait'
  const pageWidth = orientation === 'landscape' ? A4_HEIGHT_PT : A4_WIDTH_PT
  const pageHeight = orientation === 'landscape' ? A4_WIDTH_PT : A4_HEIGHT_PT
  const scale = Math.min(pageWidth / imageWidth, pageHeight / imageHeight)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale

  return {
    orientation,
    pageWidth,
    pageHeight,
    imageWidth: drawWidth,
    imageHeight: drawHeight,
    offsetX: (pageWidth - drawWidth) / 2,
    offsetY: (pageHeight - drawHeight) / 2,
  }
}

// Nome amigavel com timestamp. Recebe a data por parametro para ser puro/testavel.
export function buildScanFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `scan-${stamp}.pdf`
}

// Monta um PDF multipagina (uma imagem por pagina) e devolve como File.
export function pagesToPdfFile(pages: ScanPage[], fileName: string): File {
  if (pages.length === 0) {
    throw new Error('Nenhuma pagina capturada.')
  }

  const first = computePageLayout(pages[0].width, pages[0].height)
  const doc = new jsPDF({
    orientation: first.orientation,
    unit: 'pt',
    format: 'a4',
  })

  pages.forEach((page, index) => {
    const layout = computePageLayout(page.width, page.height)

    if (index > 0) {
      doc.addPage('a4', layout.orientation)
    }

    doc.addImage(
      page.dataUrl,
      'JPEG',
      layout.offsetX,
      layout.offsetY,
      layout.imageWidth,
      layout.imageHeight,
    )
  })

  const blob = doc.output('blob')

  if (blob.size > MAX_PDF_BYTES) {
    throw new Error(
      'O documento ficou maior que 25 MB. Tente escanear menos paginas por arquivo.',
    )
  }

  return new File([blob], fileName, { type: 'application/pdf' })
}

// Carrega um data URL/base64 num elemento de imagem (somente no browser).
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('Nao foi possivel processar a imagem escaneada.'))
    image.src = src
  })
}

// Converte um data URL/base64 numa ScanPage, reencodando para JPEG.
// O scanner nativo pode devolver PNG; reencodar garante que o addImage('JPEG')
// do jspdf receba sempre JPEG e nao gere um PDF corrompido.
export async function dataUrlToScanPage(dataUrl: string): Promise<ScanPage> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return { dataUrl, width, height }
  }

  ctx.drawImage(image, 0, 0)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width, height }
}

// Garante o prefixo data URL para strings base64 puras (ex.: vindas do plugin nativo).
export function ensureDataUrl(value: string, mimeType = 'image/jpeg'): string {
  return value.startsWith('data:') ? value : `data:${mimeType};base64,${value}`
}
