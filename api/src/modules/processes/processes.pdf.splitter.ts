import { PDFDocument } from 'pdf-lib'
import { ServiceError } from '../../shared/errors/service-error'
import type { ExtractedDocument } from './processes.extraction.types'

export interface SplitDocument {
  documentTypeKey: string
  label: string
  pageCount: number
  bytes: Uint8Array
}

// Desmembra o PDF empacotado em um PDF por tipo de documento, conforme as
// paginas classificadas. Paginas fora do intervalo real sao ignoradas.
export async function splitPdfByDocuments(
  pdfBytes: Uint8Array,
  documents: ExtractedDocument[],
): Promise<SplitDocument[]> {
  let source: PDFDocument
  try {
    source = await PDFDocument.load(pdfBytes)
  } catch {
    throw new ServiceError(
      415,
      'O PDF esta protegido por senha ou corrompido e nao pode ser desmembrado.',
    )
  }
  const totalPages = source.getPageCount()

  const results: SplitDocument[] = []

  for (const document of documents) {
    // Paginas 1-based unicas e dentro do intervalo, convertidas para 0-based.
    const indices = Array.from(new Set(document.pages))
      .filter(
        (page) => Number.isInteger(page) && page >= 1 && page <= totalPages,
      )
      .sort((a, b) => a - b)
      .map((page) => page - 1)

    if (indices.length === 0) {
      continue
    }

    const target = await PDFDocument.create()
    const copiedPages = await target.copyPages(source, indices)

    for (const page of copiedPages) {
      target.addPage(page)
    }

    const bytes = await target.save()

    results.push({
      documentTypeKey: document.documentTypeKey,
      label: document.label,
      pageCount: indices.length,
      bytes,
    })
  }

  return results
}
