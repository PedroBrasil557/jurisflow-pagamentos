import ScanbotSDK from 'scanbot-web-sdk'
import { buildScanFileName } from './scan-to-pdf'

// Os assets WASM sao servidos por vite-plugin-static-copy (ver vite.config.ts).
const ENGINE_PATH = '/vendor/document-scanner/'

let initPromise: Promise<void> | null = null

function getLicenseKey(): string {
  // A chave do Scanbot contem quebras de linha. Aceitamos tanto quebras reais
  // quanto a sequencia literal "\n" (comum quem cola a chave em uma so linha).
  return (import.meta.env.VITE_SCANBOT_LICENSE_KEY ?? '').replace(/\\n/g, '\n')
}

// Indica se o Scanbot esta configurado. Sem license key usamos o fallback jscanify.
export function isScanbotConfigured(): boolean {
  return getLicenseKey().length > 0
}

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = ScanbotSDK.initialize({
      licenseKey: getLicenseKey(),
      enginePath: ENGINE_PATH,
    })
      .then(() => undefined)
      .catch((error) => {
        initPromise = null
        throw error
      })
  }

  return initPromise
}

// Abre o scanner do Scanbot (captura automatica, ajuste de cantos, filtros e
// remocao de sombra) e devolve um PDF. Retorna null se o usuario cancelar.
export async function scanWithScanbot(): Promise<File | null> {
  await ensureInitialized()

  const config = new ScanbotSDK.UI.Config.DocumentScanningFlow()
  const result = await ScanbotSDK.UI.createDocumentScanner(config)

  if (!result) {
    return null
  }

  const pdf = await result.document.createPdf({ pageSize: 'A4' })
  const blob = new Blob([pdf], { type: 'application/pdf' })

  return new File([blob], buildScanFileName(new Date()), {
    type: 'application/pdf',
  })
}
