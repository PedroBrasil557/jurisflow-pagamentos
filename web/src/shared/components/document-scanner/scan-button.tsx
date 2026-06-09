import { Capacitor } from '@capacitor/core'
import { useQuery } from '@tanstack/react-query'
import { ScanLine } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { resolveScanbotKey, scanbotLicenseQuery } from './scanbot-license'

const WebScannerDialog = lazy(() =>
  import('./web-scanner-dialog').then((module) => ({
    default: module.WebScannerDialog,
  })),
)

type ScanButtonProps = {
  onComplete: (file: File) => void
  disabled?: boolean
}

export function ScanButton({ onComplete, disabled }: ScanButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const licenseQuery = useQuery(scanbotLicenseQuery)

  async function handleClick() {
    // No app nativo (iOS/Android) usamos o scanner do sistema (VisionKit/ML Kit).
    if (Capacitor.isNativePlatform()) {
      setBusy(true)

      try {
        const { scanWithNative } = await import('./native-scan')
        const file = await scanWithNative()

        if (file) {
          onComplete(file)
        }
      } catch {
        toast.error('Nao foi possivel escanear o documento. Tente novamente.')
      } finally {
        setBusy(false)
      }

      return
    }

    // No navegador, se houver license key (Configuracoes ou env), usamos o
    // Scanbot (qualidade CamScanner, funciona ate no iPhone). Em caso de falha
    // de licenca/engine, cai no jscanify.
    const scanbotKey = resolveScanbotKey(licenseQuery.data)
    if (scanbotKey) {
      setBusy(true)

      try {
        const { scanWithScanbot } = await import('./scanbot-scan')
        const file = await scanWithScanbot(scanbotKey)

        if (file) {
          onComplete(file)
        }

        return
      } catch {
        setOpen(true)
      } finally {
        setBusy(false)
      }

      return
    }

    // Sem Scanbot configurado: scanner web com jscanify.
    setOpen(true)
  }

  return (
    <>
      <Button
        disabled={disabled || busy}
        onClick={() => void handleClick()}
        type="button"
        variant="outline"
      >
        <ScanLine className="size-4" />
        Escanear documento
      </Button>

      {open ? (
        <Suspense fallback={null}>
          <WebScannerDialog
            onClose={() => setOpen(false)}
            onComplete={(file) => {
              setOpen(false)
              onComplete(file)
            }}
            open={open}
          />
        </Suspense>
      ) : null}
    </>
  )
}
