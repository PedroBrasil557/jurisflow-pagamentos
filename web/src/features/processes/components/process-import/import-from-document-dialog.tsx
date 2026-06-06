import { FileUp, Loader2, Sparkles, X } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { formatBytes } from '@/shared/lib/format'
import { useExtractDocuments } from '../../services/extraction.mutations'
import type { ExtractedField } from '../../services/extraction.service'

// Arquivos agrupados por slot — usados depois da criacao para anexar ao checklist.
export type ImportDocumentFiles = {
  identity: File[]
  address: File[]
  spouse: File[]
}

type DocumentSlot = keyof ImportDocumentFiles

type ImportFromDocumentDialogProps = {
  open: boolean
  onClose: () => void
  spouseEnabled: boolean
  onApply: (fields: ExtractedField[], files: ImportDocumentFiles) => void
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

function FileSlot({
  description,
  files,
  label,
  onChange,
}: {
  description: string
  files: File[]
  label: string
  onChange: (files: File[]) => void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  function handleSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files

    if (!fileList || fileList.length === 0) {
      return
    }

    onChange([...files, ...Array.from(fileList)])

    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  function handleRemove(index: number) {
    onChange(files.filter((_, i) => i !== index))
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>

      <label
        className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-4 text-center text-sm font-medium text-muted-foreground transition hover:border-primary/35 hover:bg-primary/5"
        htmlFor={inputId}
      >
        <FileUp className="size-4" />
        Selecionar arquivo(s)
      </label>

      <input
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        id={inputId}
        multiple
        onChange={handleSelected}
        ref={inputRef}
        type="file"
      />

      {files.length > 0 ? (
        <ul className="grid gap-1.5">
          {files.map((file, index) => (
            <li
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
              key={`${file.name}-${file.size}-${file.lastModified}`}
            >
              <span className="min-w-0 truncate text-sm text-foreground">
                {file.name}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(index)}
                  type="button"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function ImportFromDocumentDialog({
  open,
  onClose,
  spouseEnabled,
  onApply,
}: ImportFromDocumentDialogProps) {
  const [files, setFiles] = useState<ImportDocumentFiles>({
    identity: [],
    address: [],
    spouse: [],
  })
  const [consent, setConsent] = useState(false)
  const [result, setResult] = useState<ExtractedField[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const consentId = useId()

  const extractMutation = useExtractDocuments()

  const allFiles = useMemo(
    () => [...files.identity, ...files.address, ...files.spouse],
    [files],
  )

  function updateSlot(slot: DocumentSlot) {
    return (next: File[]) => setFiles((prev) => ({ ...prev, [slot]: next }))
  }

  function handleClose() {
    setFiles({ identity: [], address: [], spouse: [] })
    setConsent(false)
    setResult(null)
    setWarnings([])
    setSelectedKeys(new Set())
    extractMutation.reset()
    onClose()
  }

  async function handleExtract() {
    if (allFiles.length === 0) {
      toast.error('Envie ao menos um documento.')
      return
    }

    if (!consent) {
      toast.error('Confirme o consentimento para enviar os documentos.')
      return
    }

    try {
      const extraction = await extractMutation.mutateAsync(allFiles)

      setResult(extraction.fields)
      setWarnings(extraction.warnings)
      setSelectedKeys(
        new Set(extraction.fields.filter((f) => f.valid).map((f) => f.key)),
      )

      if (extraction.fields.length === 0) {
        toast.warning('Nenhum dado foi reconhecido nos documentos enviados.')
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
    if (!result) {
      return
    }

    const selected = result.filter((field) => selectedKeys.has(field.key))

    if (selected.length === 0) {
      toast.error('Selecione ao menos um campo para aplicar.')
      return
    }

    onApply(selected, files)
    handleClose()
  }

  const isExtracting = extractMutation.isPending

  return (
    <AppDialog
      description="Envie o RG/CNH e o comprovante de endereco. Os dados serao lidos por IA para preencher o cadastro; voce revisa antes de salvar."
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
              Revise os dados lidos e escolha quais aplicar ao formulario.
            </p>

            {warnings.length > 0 ? (
              <div className="grid gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                {warnings.map((warning) => (
                  <p
                    className="text-sm text-amber-700 dark:text-amber-400"
                    key={warning}
                  >
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            {result.length > 0 ? (
              <ul className="grid gap-2">
                {result.map((field) => (
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
            ) : (
              <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                Nenhum dado reconhecido. Tente enviar imagens mais nitidas.
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                onClick={() => setResult(null)}
                type="button"
                variant="outline"
              >
                Trocar documentos
              </Button>
              <Button onClick={handleApply} type="button">
                Usar dados selecionados
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            <FileSlot
              description="RG, CNH ou documento de identidade do titular."
              files={files.identity}
              label="Documento de identidade (RG/CNH)"
              onChange={updateSlot('identity')}
            />

            <FileSlot
              description="Conta de luz, agua ou outro comprovante recente."
              files={files.address}
              label="Comprovante de endereco"
              onChange={updateSlot('address')}
            />

            {spouseEnabled ? (
              <FileSlot
                description="RG, CNH ou documento de identidade do conjuge."
                files={files.spouse}
                label="Documento de identidade do conjuge (opcional)"
                onChange={updateSlot('spouse')}
              />
            ) : null}

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
                Estou ciente de que os documentos enviados serao processados por
                um servico de inteligencia artificial (Anthropic) para extracao
                dos dados.
              </label>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={handleClose} type="button" variant="outline">
                Cancelar
              </Button>
              <Button
                disabled={isExtracting || allFiles.length === 0 || !consent}
                onClick={() => void handleExtract()}
                type="button"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Extraindo...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Extrair dados
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
