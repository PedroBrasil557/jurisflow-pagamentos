import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useSession } from '@/features/auth/hooks/use-session'
import {
  BackLink,
  DeniedState,
  FinanceSection,
} from '@/features/finance/components/finance-ui'
import { financeAccess } from '@/features/finance/lib/finance-labels'
import {
  useConfirmImport,
  usePreviewImport,
} from '@/features/finance/services/finance.mutations'
import type { ImportPreview } from '@/features/finance/services/finance.service'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'

export const Route = createFileRoute(
  '/_protected/pagamentos/configuracao/importar',
)({
  component: ImportPage,
})

/** P04C: importação alimenta a MESMA estrutura do cadastro manual. */
function ImportPage() {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const previewMutation = usePreviewImport()
  const confirmMutation = useConfirmImport()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})

  if (!financeAccess.importar(permissions)) return <DeniedState />

  function runPreview(nextMapping?: Record<string, string>) {
    if (!file) return
    previewMutation.mutate(
      { file, mapping: nextMapping },
      {
        onSuccess: (result) => {
          setPreview(result)
          setMapping(result.mapping)
        },
      },
    )
  }

  const canConfirm =
    preview !== null &&
    preview.mappingErrors.length === 0 &&
    preview.summary.total > 0 &&
    preview.summary.invalid === 0

  return (
    <div className="flex flex-col gap-6">
      <BackLink label="Configuração" to="/pagamentos/configuracao" />
      <PageHeader
        description="Arquivo → leitura → mapeamento → validação → prévia → confirmação. Nada é gravado antes de confirmar, e o motor não consulta a planilha depois."
        eyebrow="Pagamentos · configuração"
        title="Importar configuração"
      />

      <FinanceSection
        description="CSV (separador ; ou ,) ou XLSX, até 1 MB. Colunas esperadas: Colaborador, Trabalho, Base (A, C, I, J ou M), Percentual ou Valor fixo, Vigência início/fim, Condomínios (separados por ;)."
        title="1. Arquivo"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="import-file">Planilha</Label>
            <Input
              accept=".csv,.xlsx"
              id="import-file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setPreview(null)
              }}
              type="file"
            />
          </div>
          <Button
            disabled={!file || previewMutation.isPending}
            onClick={() => runPreview()}
          >
            <FileSpreadsheet className="size-4" />
            {previewMutation.isPending ? 'Lendo…' : 'Ler e validar'}
          </Button>
        </div>
      </FinanceSection>

      {preview ? (
        <>
          <FinanceSection
            description="Ajuste as colunas se o cabeçalho for diferente e valide de novo."
            title="2. Mapeamento"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.fields.map((field) => (
                <div className="grid gap-1.5" key={field.field}>
                  <Label htmlFor={`map-${field.field}`}>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </Label>
                  <NativeSelect
                    id={`map-${field.field}`}
                    onChange={(e) =>
                      setMapping((current) => {
                        const next = { ...current }
                        if (e.target.value) next[field.field] = e.target.value
                        else delete next[field.field]
                        return next
                      })
                    }
                    value={mapping[field.field] ?? ''}
                  >
                    <NativeSelectOption value="">
                      — não mapeado —
                    </NativeSelectOption>
                    {preview.headers.map((header) => (
                      <NativeSelectOption key={header} value={header}>
                        {header}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                disabled={previewMutation.isPending}
                onClick={() => runPreview(mapping)}
                variant="outline"
              >
                Validar novamente
              </Button>
            </div>
          </FinanceSection>

          <FinanceSection
            description={`${preview.fileName} · SHA-256 ${preview.fileSha256.slice(0, 12)}…`}
            title="3. Prévia"
          >
            {preview.mappingErrors.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Mapeamento incompleto</AlertTitle>
                <AlertDescription>
                  {preview.mappingErrors.join(' ')}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  <StatusBadge tone="info">{`${preview.summary.total} linha(s)`}</StatusBadge>
                  <StatusBadge tone="success">{`${preview.summary.valid} válida(s)`}</StatusBadge>
                  <StatusBadge
                    tone={preview.summary.invalid ? 'error' : 'ghost'}
                  >
                    {`${preview.summary.invalid} com pendência`}
                  </StatusBadge>
                  {preview.summary.newRecipients.length > 0 ? (
                    <StatusBadge tone="warning">
                      {`Novos recebedores: ${preview.summary.newRecipients.join(', ')}`}
                    </StatusBadge>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Linha</TableHead>
                        {preview.fields
                          .filter((f) => mapping[f.field])
                          .map((f) => (
                            <TableHead key={f.field}>{f.label}</TableHead>
                          ))}
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row) => (
                        <TableRow key={row.line}>
                          <TableCell>{row.line}</TableCell>
                          {preview.fields
                            .filter((f) => mapping[f.field])
                            .map((f) => (
                              <TableCell className="text-sm" key={f.field}>
                                {row.values[f.field]}
                              </TableCell>
                            ))}
                          <TableCell className="text-sm">
                            {row.errors.length === 0 ? (
                              <StatusBadge tone="success">OK</StatusBadge>
                            ) : (
                              <span className="text-destructive">
                                {row.errors.join(' ')}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-col items-end gap-2">
              {!canConfirm ? (
                <p className="text-xs text-muted-foreground">
                  Corrija todas as pendências para confirmar (tudo ou nada).
                </p>
              ) : null}
              <Button
                disabled={!canConfirm || confirmMutation.isPending || !file}
                onClick={() =>
                  file &&
                  confirmMutation.mutate(
                    { file, mapping },
                    {
                      onSuccess: (result) => {
                        toast.success(
                          result.replayed
                            ? 'Esta importação já havia sido confirmada.'
                            : 'Configuração importada.',
                        )
                        navigate({ to: '/pagamentos/configuracao' })
                      },
                    },
                  )
                }
              >
                <Upload className="size-4" />
                Confirmar importação
              </Button>
            </div>
          </FinanceSection>
        </>
      ) : null}
    </div>
  )
}
