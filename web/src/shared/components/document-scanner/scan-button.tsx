import { useQuery } from '@tanstack/react-query'
import { ScanLine } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import {
  resolveScanbotKey,
  scanbotLicenseQuery,
  scannerProviderQuery,
} from './scanbot-license'

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
  const providerQuery = useQuery(scannerProviderQuery)
  const licenseQuery = useQuery(scanbotLicenseQuery)

  // Servico escolhido no painel de Configuracoes ('scanbot' | 'web' |
  // 'docaligner').
  const provider = providerQuery.data ?? 'web'

  async function handleClick() {
    // Scanner web (jscanify) e DocAligner (IA) usam o mesmo dialogo no
    // navegador; sem licenca. O DocAligner liga a deteccao por IA via `useMl`.
    if (provider === 'web' || provider === 'docaligner') {
      setOpen(true)
      return
    }

    // Scanbot: requer license. Falha dura (sem licenca / SDK nao inicia) cai no
    // Scanner web COM aviso — digitalizar nao pode ficar 100% quebrado.
    const scanbotKey = resolveScanbotKey(licenseQuery.data)

    if (!scanbotKey) {
      toast.warning(
        'Scanbot selecionado, mas sem license configurada — usando o scanner web.',
      )
      setOpen(true)
      return
    }

    setBusy(true)
    try {
      const { scanWithScanbot } = await import('./scanbot-scan')
      const file = await scanWithScanbot(scanbotKey)
      if (file) {
        onComplete(file)
      }
    } catch (error) {
      // Loga o motivo completo (devtools) e mostra um resumo no toast, para dar
      // pra saber por que o Scanbot nao abriu (licenca/dominio/WASM/rede).
      console.error('Falha ao iniciar o Scanbot', error)
      const reason =
        error instanceof Error && error.message
          ? `: ${error.message.slice(0, 140)}`
          : ''
      toast.warning(`Scanbot indisponivel${reason} — usando o scanner web.`)
      setOpen(true)
    } finally {
      setBusy(false)
    }
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
            useMl={provider === 'docaligner'}
          />
        </Suspense>
      ) : null}
    </>
  )
}
