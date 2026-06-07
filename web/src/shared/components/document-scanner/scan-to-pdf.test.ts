import { describe, expect, it } from 'vitest'
import {
  buildScanFileName,
  computePageLayout,
  ensureDataUrl,
  pagesToPdfFile,
} from './scan-to-pdf'

describe('computePageLayout', () => {
  it('usa retrato para imagens mais altas que largas', () => {
    const layout = computePageLayout(1000, 1400)
    expect(layout.orientation).toBe('portrait')
    expect(layout.pageWidth).toBeLessThan(layout.pageHeight)
  })

  it('usa paisagem para imagens mais largas que altas', () => {
    const layout = computePageLayout(1400, 1000)
    expect(layout.orientation).toBe('landscape')
    expect(layout.pageWidth).toBeGreaterThan(layout.pageHeight)
  })

  it('mantem a imagem dentro da pagina e centralizada', () => {
    const layout = computePageLayout(1000, 1400)
    expect(layout.imageWidth).toBeLessThanOrEqual(layout.pageWidth + 0.01)
    expect(layout.imageHeight).toBeLessThanOrEqual(layout.pageHeight + 0.01)
    expect(layout.offsetX).toBeGreaterThanOrEqual(0)
    expect(layout.offsetY).toBeGreaterThanOrEqual(0)
  })
})

describe('buildScanFileName', () => {
  it('gera um nome com prefixo scan e extensao pdf', () => {
    const name = buildScanFileName(new Date('2026-06-06T13:45:30.000Z'))
    expect(name).toBe('scan-2026-06-06T13-45-30.pdf')
  })
})

describe('ensureDataUrl', () => {
  it('mantem data URLs intactas', () => {
    expect(ensureDataUrl('data:image/png;base64,AAA')).toBe(
      'data:image/png;base64,AAA',
    )
  })

  it('prefixa base64 puro como JPEG', () => {
    expect(ensureDataUrl('AAA')).toBe('data:image/jpeg;base64,AAA')
  })
})

describe('pagesToPdfFile', () => {
  it('lanca erro quando nao ha paginas', () => {
    expect(() => pagesToPdfFile([], 'scan.pdf')).toThrow()
  })

  it('gera um File PDF a partir das paginas', () => {
    // JPEG 1x1 minimo (base64) apenas para validar a montagem do PDF.
    const jpeg1x1 =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q=='
    const file = pagesToPdfFile(
      [{ dataUrl: jpeg1x1, width: 1000, height: 1400 }],
      'scan.pdf',
    )
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('application/pdf')
    expect(file.size).toBeGreaterThan(0)
  })
})
