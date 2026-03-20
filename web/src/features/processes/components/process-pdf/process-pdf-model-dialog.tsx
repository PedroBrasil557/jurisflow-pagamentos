import { FileText, Loader2 } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import type { ProcessPdfModelOption } from '../../services/processes.service'

type ProcessPdfModelDialogProps = {
  errorMessage?: string
  isGenerating?: boolean
  isLoading?: boolean
  models: readonly ProcessPdfModelOption[]
  onCancel: () => void
  onSelect: (modelKey: ProcessPdfModelOption['key']) => void
  selectedModelKey?: ProcessPdfModelOption['key'] | null
}

export function ProcessPdfModelDialog({
  errorMessage = '',
  isGenerating = false,
  isLoading = false,
  models,
  onCancel,
  onSelect,
  selectedModelKey = null,
}: ProcessPdfModelDialogProps) {
  return (
    <AppDialog
      description="Escolha qual modelo deseja usar para gerar o PDF deste processo."
      footer={
        <Button
          disabled={isGenerating}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Cancelar
        </Button>
      }
      icon={FileText}
      maxWidth="3xl"
      onClose={onCancel}
      open={true}
      title="Selecione o modelo"
      variant="info"
    >
      {isLoading ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-border bg-muted/35 px-6 py-10 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando modelos...</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {models.map((model) => (
            <button
              className={`cursor-pointer rounded-[1.5rem] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                selectedModelKey === model.key
                  ? 'border-primary bg-primary/8 shadow-primary/10'
                  : 'border-border bg-card hover:border-primary/35'
              }`}
              disabled={isGenerating}
              key={model.key}
              onClick={() => onSelect(model.key)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-2">
                  <p className="text-base font-semibold text-foreground">
                    {model.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {model.description}
                  </p>
                </div>

                {selectedModelKey === model.key && isGenerating ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <Badge variant="outline">PDF</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {errorMessage ? (
        <div className="rounded-3xl border border-destructive/20 bg-destructive/10 px-4 py-3">
          <span className="text-sm text-destructive">{errorMessage}</span>
        </div>
      ) : null}
    </AppDialog>
  )
}
