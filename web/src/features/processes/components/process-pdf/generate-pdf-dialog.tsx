import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { AppDialog } from '@/shared/components/app-dialog'
import { useGenerateProcessPdf } from '../../services/processes.mutations'
import { pdfModelsOptions } from '../../services/processes.queries'
import type { GenerateProcessPdfModelKey } from '../../services/processes.service'

type GeneratePdfDialogProps = {
  onClose: () => void
  open: boolean
  processId: string
}

function openDownloadUrl(url: string) {
  const link = document.createElement('a')

  link.href = url
  link.rel = 'noopener noreferrer'
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function GeneratePdfDialog({
  onClose,
  open,
  processId,
}: GeneratePdfDialogProps) {
  const modelsQuery = useQuery({
    ...pdfModelsOptions(processId),
    enabled: open && !!processId,
  })
  const generateMutation = useGenerateProcessPdf(processId)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  async function handleSelect(modelKey: GenerateProcessPdfModelKey) {
    try {
      setSelectedKey(modelKey)
      const result = await generateMutation.mutateAsync(modelKey)

      openDownloadUrl(result.document.downloadUrl)
      toast.success('PDF gerado com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel gerar o PDF.',
      )
    } finally {
      setSelectedKey(null)
    }
  }

  const models = modelsQuery.data?.items ?? []

  return (
    <AppDialog
      description="Escolha qual modelo deseja usar para gerar o PDF."
      footer={
        <Button
          disabled={generateMutation.isPending}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancelar
        </Button>
      }
      icon={FileText}
      maxWidth="2xl"
      onClose={onClose}
      open={open}
      title="Gerar PDF"
      variant="info"
    >
      {modelsQuery.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : models.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum modelo disponivel.
        </p>
      ) : (
        <div className="grid gap-3">
          {models.map((model) => {
            const isSelected = selectedKey === model.key
            const isGenerating = generateMutation.isPending

            return (
              <button
                className={`flex items-center justify-between gap-4 rounded-lg border p-4 text-left transition ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30 hover:bg-muted/30'
                }`}
                disabled={isGenerating}
                key={model.key}
                onClick={() => handleSelect(model.key)}
                type="button"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {model.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {model.description}
                  </p>
                </div>

                {isSelected && isGenerating ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Badge variant="outline">PDF</Badge>
                )}
              </button>
            )
          })}
        </div>
      )}
    </AppDialog>
  )
}
