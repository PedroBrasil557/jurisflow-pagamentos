import { FileText, Loader2, Sparkles, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { formatBytes } from '@/shared/lib/format'
import {
  type ExtractDocumentsResponse,
  type ExtractedDocument,
  type ExtractedField,
  extractDocumentsRequest,
} from '../../services/extraction.service'

const MAX_FILES = 10

// Cada PDF com sua propria classificacao de paginas (anexado apos criar o processo).
export type ImportDocumentBundle = {
  file: File
  documents: ExtractedDocument[]
}

type DocumentSummaryItem = {
  documentTypeKey: string
  label: string
  pageCount: number
}

type MergedExtraction = {
  fields: ExtractedField[]
  warnings: string[]
  documents: DocumentSummaryItem[]
  bundles: ImportDocumentBundle[]
}

type ImportFromDocumentDialogProps = {
  open: boolean
  onClose: () => void
  onApply: (fields: ExtractedField[], bundles: ImportDocumentBundle[]) => void
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

const confidenceRank = { alta: 3, media: 2, baixa: 1 } as const

// Mescla os campos de varios arquivos: por chave, prefere o valido e de maior confianca.
function mergeExtractedFields(
  results: ExtractDocumentsResponse[],
): ExtractedField[] {
  const byKey = new Map<string, ExtractedField>()

  for (const result of results) {
    for (const field of result.fields) {
      const current = byKey.get(field.key)

      if (!current) {
        byKey.set(field.key, field)
        continue
      }

      if (current.valid !== field.valid) {
        if (field.valid) byKey.set(field.key, field)
        continue
      }

      if (
        confidenceRank[field.confidence] > confidenceRank[current.confidence]
      ) {
        byKey.set(field.key, field)
      }
    }
  }

  return Array.from(byKey.values())
}

// Agrega a contagem de paginas por tipo de documento entre todos os arquivos.
function summarizeDocuments(
  bundles: ImportDocumentBundle[],
): DocumentSummaryItem[] {
  const byKey = new Map<string, DocumentSummaryItem>()

  for (const bundle of bundles) {
    for (const document of bundle.documents) {
      const current = byKey.get(document.documentTypeKey)

      if (current) {
        current.pageCount += document.pages.length
      } else {
        byKey.set(document.documentTypeKey, {
          documentTypeKey: document.documentTypeKey,
          label: document.label,
          pageCount: document.pages.length,
        })
      }
    }
  }

  return Array.from(byKey.values())
}

export function ImportFromDocumentDialog({
  open,
  onClose,
  onApply,
}: ImportFromDocumentDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [result, setResult] = useState<MergedExtraction | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [isExtracting, setIsExtracting] = useState(false)

  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  function handleClose() {
    setFiles([])
    setResult(null)
    setSelectedKeys(new Set())
    setIsExtracting(false)
    onClose()
  }

  function handleSelectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])

    if (inputRef.current) {
      inputRef.current.value = ''
    }

    if (selected.length === 0) {
      return
    }

    const pdfs = selected.filter(
      (f) =>
        f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    )

    if (pdfs.length < selected.length) {
      toast.warning(
        'Apenas arquivos PDF sao aceitos; os demais foram ignorados.',
      )
    }

    if (pdfs.length === 0) {
      return
    }

    // Atualizacao a partir do estado atual (sem efeitos colaterais no updater).
    const merged = [...files]
    for (const next of pdfs) {
      const exists = merged.some(
        (f) =>
          f.name === next.name &&
          f.size === next.size &&
          f.lastModified === next.lastModified,
      )
      if (!exists) merged.push(next)
    }

    if (merged.length > MAX_FILES) {
      toast.warning(`Maximo de ${MAX_FILES} arquivos por importacao.`)
    }

    setFiles(merged.slice(0, MAX_FILES))
  }

  function handleRemoveFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleExtract() {
    if (files.length === 0) {
      toast.error('Selecione ao menos um arquivo PDF.')
      return
    }

    setIsExtracting(true)

    try {
      const settled = await Promise.allSettled(
        files.map((file) => extractDocumentsRequest(file)),
      )

      const okResults: ExtractDocumentsResponse[] = []
      const bundles: ImportDocumentBundle[] = []
      const failedFiles: string[] = []

      settled.forEach((outcome, index) => {
        const file = files[index]
        if (!file) return

        if (outcome.status === 'fulfilled') {
          okResults.push(outcome.value)
          if (outcome.value.documents.length > 0) {
            bundles.push({ file, documents: outcome.value.documents })
          }
        } else {
          failedFiles.push(file.name)
        }
      })

      if (okResults.length === 0) {
        toast.error('Nao foi possivel extrair os dados dos arquivos enviados.')
        return
      }

      const fields = mergeExtractedFields(okResults)
      const documents = summarizeDocuments(bundles)

      // Tipo que aparece em >1 arquivo: o item de checklist guarda 1 arquivo,
      // entao apenas o ultimo sera anexado — avisa o usuario para evitar perda silenciosa.
      const bundleCountByKey = new Map<string, number>()
      for (const bundle of bundles) {
        for (const key of new Set(
          bundle.documents.map((d) => d.documentTypeKey),
        )) {
          bundleCountByKey.set(key, (bundleCountByKey.get(key) ?? 0) + 1)
        }
      }
      const labelByKey = new Map(
        documents.map((d) => [d.documentTypeKey, d.label]),
      )
      const duplicateWarnings = Array.from(bundleCountByKey.entries())
        .filter(([, count]) => count > 1)
        .map(
          ([key]) =>
            `"${labelByKey.get(key) ?? key}" aparece em mais de um arquivo — apenas o ultimo sera anexado.`,
        )

      const warnings = [
        ...new Set(okResults.flatMap((r) => r.warnings)),
        ...duplicateWarnings,
      ]

      setResult({ fields, warnings, documents, bundles })
      setSelectedKeys(new Set(fields.filter((f) => f.valid).map((f) => f.key)))

      if (failedFiles.length > 0) {
        toast.warning(
          `Nao foi possivel processar: ${failedFiles.join(', ')}. Os demais seguiram.`,
        )
      }

      if (fields.length === 0 && bundles.length === 0) {
        toast.warning('Nada foi reconhecido nos arquivos enviados.')
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel extrair os dados.',
      )
    } finally {
      setIsExtracting(false)
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

    const selected = result.fields.filter((field) =>
      selectedKeys.has(field.key),
    )

    onApply(selected, result.bundles)
    handleClose()
  }

  const footer = result ? (
    <>
      <Button onClick={() => setResult(null)} type="button" variant="outline">
        Trocar documentos
      </Button>
      <Button onClick={handleApply} type="button">
        Usar dados
      </Button>
    </>
  ) : (
    <>
      <Button onClick={handleClose} type="button" variant="outline">
        Cancelar
      </Button>
      <Button
        disabled={isExtracting || files.length === 0}
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
    </>
  )

  return (
    <AppDialog
      description="Envie um ou mais PDFs com os documentos. A IA preenche o cadastro e separa cada documento para anexar ao checklist apos criar o processo."
      footer={footer}
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
                        {`${document.label} (${document.pageCount} pag.)`}
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
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <span className="text-sm font-medium text-foreground">
                Arquivos PDF
              </span>
              <span className="text-xs text-muted-foreground">
                Um ou mais PDFs com os documentos (RG/CNH, comprovante,
                procuracao, etc.). Eles podem estar em arquivos separados.
              </span>

              <label
                className={`flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm font-medium text-muted-foreground transition ${
                  isExtracting
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:border-primary/35 hover:bg-primary/5'
                }`}
                htmlFor={inputId}
              >
                <FileText className="size-4" />
                {files.length > 0
                  ? 'Adicionar mais PDFs'
                  : 'Selecionar arquivos PDF'}
              </label>

              <input
                accept="application/pdf"
                className="hidden"
                disabled={isExtracting}
                id={inputId}
                multiple
                onChange={handleSelectFiles}
                ref={inputRef}
                type="file"
              />

              {files.length > 0 ? (
                <ul className="grid gap-1.5">
                  {files.map((file, index) => (
                    <li
                      className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                    >
                      <span
                        className="min-w-0 truncate text-sm text-foreground"
                        title={file.name}
                      >
                        {file.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                        <button
                          aria-label={`Remover ${file.name}`}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                          disabled={isExtracting}
                          onClick={() => handleRemoveFile(index)}
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
          </div>
        )}
      </div>
    </AppDialog>
  )
}
