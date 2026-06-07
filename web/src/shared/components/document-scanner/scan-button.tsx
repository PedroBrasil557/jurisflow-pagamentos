import { Capacitor } from '@capacitor/core'
import { ScanLine } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'

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

    // No navegador usamos o scanner web (jscanify).
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
