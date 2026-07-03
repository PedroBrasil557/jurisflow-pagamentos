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
  // scanSessionId: id da sessao de captura (IndexedDB) para o consumidor limpar
  // apos o upload confirmar; null quando nao ha sessao persistida (Scanbot).
  // pageLongEdgesPx: telemetria de nitidez (lado longo em px por pagina);
  // ausente no caminho Scanbot (o PDF chega pronto, sem as dimensoes).
  onComplete: (
    file: File,
    scanSessionId: string | null,
    pageLongEdgesPx?: number[],
  ) => void
  disabled?: boolean
  label?: string
  className?: string
}

export function ScanButton({
  onComplete,
  disabled,
  label = 'Escanear documento',
  className,
}: ScanButtonProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const providerQuery = useQuery(scannerProviderQuery)
  const licenseQuery = useQuery(scanbotLicenseQuery)

  // Servico escolhido no painel de Configuracoes ('scanbot' | 'docaligner').
  const provider = providerQuery.data ?? 'docaligner'

  async function handleClick() {
    // DocAligner (IA): scanner do navegador, sem licenca. Detector unico.
    if (provider !== 'scanbot') {
      setOpen(true)
      return
    }

    // Scanbot: requer license. Falha dura (sem licenca / SDK nao inicia) cai no
    // scanner do navegador COM aviso — digitalizar nao pode ficar 100% quebrado.
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
        // Scanbot devolve o PDF pronto — nao ha sessao IndexedDB a limpar.
        onComplete(file, null)
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
        className={className}
        disabled={disabled || busy}
        onClick={() => void handleClick()}
        type="button"
        variant="outline"
      >
        <ScanLine className="size-4" />
        {label}
      </Button>

      {open ? (
        <Suspense fallback={null}>
          <WebScannerDialog
            onClose={() => setOpen(false)}
            onComplete={(file, scanSessionId, pageLongEdgesPx) => {
              setOpen(false)
              onComplete(file, scanSessionId, pageLongEdgesPx)
            }}
            open={open}
          />
        </Suspense>
      ) : null}
    </>
  )
}
