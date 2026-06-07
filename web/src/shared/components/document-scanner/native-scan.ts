import {
  DocumentScanner,
  ResponseType,
  ScanDocumentResponseStatus,
  ScannerMode,
} from '@capgo/capacitor-document-scanner'
import {
  buildScanFileName,
  dataUrlToScanPage,
  ensureDataUrl,
  pagesToPdfFile,
} from './scan-to-pdf'

// Dispara o scanner nativo (VisionKit no iOS, ML Kit no Android) e devolve um PDF.
// Retorna null se o usuario cancelar.
export async function scanWithNative(): Promise<File | null> {
  const result = await DocumentScanner.scanDocument({
    responseType: ResponseType.Base64,
    letUserAdjustCrop: true,
    scannerMode: ScannerMode.Full,
  })

  if (
    result.status === ScanDocumentResponseStatus.Cancel ||
    !result.scannedImages?.length
  ) {
    return null
  }

  const pages = await Promise.all(
    result.scannedImages.map((image) =>
      dataUrlToScanPage(ensureDataUrl(image)),
    ),
  )

  return pagesToPdfFile(pages, buildScanFileName(new Date()))
}
