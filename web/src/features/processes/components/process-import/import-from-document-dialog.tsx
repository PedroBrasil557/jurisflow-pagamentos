import { FileText, Loader2, Sparkles, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { formatBytes } from '@/shared/lib/format'
import { useExtractDocuments } from '../../services/extraction.mutations'
import type {
  ExtractDocumentsResponse,
  ExtractedDocument,
  ExtractedField,
} from '../../services/extraction.service'

type ImportFromDocumentDialogProps = {
  open: boolean
  onClose: () => void
  onApply: (
    fields: ExtractedField[],
    file: File,
    documents: ExtractedDocument[],
  ) => void
}

const confidenceTone = {
  alta: 'success',
  media: 'warning',
  baixa: 'error',
} as const

const confidenceLabel = {
  alta: 'Confianca alta',
  media: 'Confianca media',
  baixa: 'Confianca baixa',
} as const

export function ImportFromDocumentDialog({
  open,
  onClose,
  onApply,
}: ImportFromDocumentDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<ExtractDocumentsResponse | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const consentId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const extractMutation = useExtractDocuments()
  const isExtracting = extractMutation.isPending

  function handleClose() {
    setFile(null)
    setConsent(false)
    setResult(null)
    setSelectedKeys(new Set())
    extractMutation.reset()
    onClose()
  }

  function handleSelectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setFile(selected)

    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  async function handleExtract() {
    if (!file) {
      toast.error('Selecione o arquivo PDF.')
      return
    }

    if (!consent) {
      toast.error('Confirme o consentimento para enviar o documento.')
      return
    }

    try {
      const extraction = await extractMutation.mutateAsync(file)

      setResult(extraction)
      setSelectedKeys(
        new Set(extraction.fields.filter((f) => f.valid).map((f) => f.key)),
      )

      if (extraction.fields.length === 0 && extraction.documents.length === 0) {
        toast.warning('Nada foi reconhecido no PDF enviado.')
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel extrair os dados.',
      )
    }
  }

  function toggleField(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }

  function handleApply() {
    if (!result || !file) {
      return
    }

    const selected = result.fields.filter((field) =>
      selectedKeys.has(field.key),
    )

    onApply(selected, file, result.documents)
    handleClose()
  }

  return (
    <AppDialog
      description="Envie um unico PDF com todos os documentos. A IA preenche o cadastro e separa os documentos para anexar ao checklist apos criar o processo."
      icon={Sparkles}
      maxWidth="2xl"
      onClose={handleClose}
      open={open}
      title="Importar de documentos"
      variant="info"
    >
      <div className="grid gap-5">
        {result ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Revise os dados lidos e escolha quais aplicar ao formulario. Os
              documentos abaixo serao anexados ao checklist apos criar o
              processo.
            </p>

            {result.warnings.length > 0 ? (
              <div className="grid gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                {result.warnings.map((warning) => (
                  <p
                    className="text-sm text-amber-700 dark:text-amber-400"
                    key={warning}
                  >
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            {result.documents.length > 0 ? (
              <div className="grid gap-2">
                <span className="text-sm font-medium text-foreground">
                  Documentos identificados
                </span>
                <ul className="flex flex-wrap gap-2">
                  {result.documents.map((document) => (
                    <li key={document.documentTypeKey}>
                      <StatusBadge tone="info">
                        {`${document.label} (${document.pages.length} pag.)`}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                Nenhum documento foi reconhecido para anexar ao checklist.
              </p>
            )}

            {result.fields.length > 0 ? (
              <div className="grid gap-2">
                <span className="text-sm font-medium text-foreground">
                  Dados para o formulario
                </span>
                <ul className="grid gap-2">
                  {result.fields.map((field) => (
                    <li
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
                      key={field.key}
                    >
                      <Checkbox
                        checked={selectedKeys.has(field.key)}
                        className="mt-0.5"
                        onCheckedChange={() => toggleField(field.key)}
                      />
                      <div className="grid min-w-0 flex-1 gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {field.label}
                          </span>
                          <StatusBadge tone={confidenceTone[field.confidence]}>
                            {confidenceLabel[field.confidence]}
                          </StatusBadge>
                          <span className="text-xs text-muted-foreground">
                            {field.source}
                          </span>
                        </div>
                        <span className="truncate text-sm text-muted-foreground">
                          {field.value}
                        </span>
                        {field.warning ? (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            {field.warning}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setResult(null)}
                type="button"
                variant="outline"
              >
                Trocar documento
              </Button>
              <Button onClick={handleApply} type="button">
                Usar dados
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <span className="text-sm font-medium text-foreground">
                Arquivo PDF unico
              </span>
              <span className="text-xs text-muted-foreground">
                Um unico PDF contendo todos os documentos (RG/CNH, comprovante,
                procuracao, etc.), na ordem em que serao separados.
              </span>

              <label
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm font-medium text-muted-foreground transition hover:border-primary/35 hover:bg-primary/5"
                htmlFor={inputId}
              >
                <FileText className="size-4" />
                {file ? 'Trocar arquivo PDF' : 'Selecionar arquivo PDF'}
              </label>

              <input
                accept="application/pdf"
                className="hidden"
                id={inputId}
                onChange={handleSelectFile}
                ref={inputRef}
                type="file"
              />

              {file ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {file.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setFile(null)}
                      type="button"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <Checkbox
                checked={consent}
                className="mt-0.5"
                id={consentId}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              <label
                className="text-sm text-muted-foreground"
                htmlFor={consentId}
              >
                Estou ciente de que o documento enviado sera processado por um
                servico de inteligencia artificial (Anthropic) para extracao dos
                dados.
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={handleClose} type="button" variant="outline">
                Cancelar
              </Button>
              <Button
                disabled={isExtracting || !file || !consent}
                onClick={() => void handleExtract()}
                type="button"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Extrair e separar
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppDialog>
  )
}
