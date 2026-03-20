import { CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'

type ProcessSaveSuccessDialogProps = {
  isBusy?: boolean
  mode: 'create' | 'edit'
  onClose: () => void
  onComplete: () => void
  onGeneratePdf: () => void
  processName: string
}

export function ProcessSaveSuccessDialog({
  isBusy = false,
  mode,
  onClose,
  onComplete,
  onGeneratePdf,
  processName,
}: ProcessSaveSuccessDialogProps) {
  const title =
    mode === 'create' ? 'Cadastro concluido!' : 'Atualizacao concluida!'
  const subtitle =
    mode === 'create'
      ? `Os dados de ${processName} foram salvos com sucesso.`
      : `As informacoes de ${processName} foram atualizadas com sucesso.`

  return (
    <AppDialog
      description={subtitle}
      icon={CheckCircle}
      maxWidth="xl"
      onClose={onClose}
      open={true}
      title={title}
      variant="success"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          disabled={isBusy}
          onClick={onComplete}
          type="button"
          variant="outline"
        >
          Concluir
        </Button>
        <Button disabled={isBusy} onClick={onGeneratePdf} type="button">
          {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
          Gerar PDF
        </Button>
      </div>
    </AppDialog>
  )
}
