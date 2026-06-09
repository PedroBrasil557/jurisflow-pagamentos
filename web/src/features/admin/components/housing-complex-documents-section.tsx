import { useQuery } from '@tanstack/react-query'
import { Download, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { formatBytes } from '@/shared/lib/format'
import {
  useDeleteHousingComplexFile,
  useUploadHousingComplexFile,
} from '../services/admin-housing-complexes.mutations'
import { housingComplexFilesOptions } from '../services/admin-housing-complexes.queries'
import type { HousingComplexFile } from '../services/admin-housing-complexes.service'

const CONJUNTO_DOC_TYPES = [
  { key: 'solicitacao_caixa', label: 'Solicitacao SAC Caixa' },
  { key: 'requerimento_adm_caixa', label: 'Requerimento administrativo Caixa' },
  { key: 'matricula_imovel', label: 'Visualizacao da matricula do imovel' },
] as const

type DocRowProps = {
  label: string
  file?: HousingComplexFile
  onUpload: (file: File) => void
  onRemove: () => void
  busy: boolean
}

function DocRow({ label, file, onUpload, onRemove, busy }: DocRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {file ? (
          <span className="truncate text-xs text-muted-foreground">
            {`${file.originalFileName} • ${formatBytes(file.sizeInBytes)}`}
          </span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Pendente
          </span>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        {file ? (
          <Button asChild size="sm" type="button" variant="outline">
            <a href={file.downloadUrl} rel="noreferrer" target="_blank">
              <Download className="size-3.5" />
              Baixar
            </a>
          </Button>
        ) : null}

        <Button
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant={file ? 'outline' : 'default'}
        >
          <Upload className="size-3.5" />
          {file ? 'Substituir' : 'Anexar'}
        </Button>

        {file ? (
          <Button
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={onRemove}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}

        <input
          accept="application/pdf,image/*"
          aria-label={`Anexar ${label}`}
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0]
            if (inputRef.current) {
              inputRef.current.value = ''
            }
            if (selected) {
              onUpload(selected)
            }
          }}
          ref={inputRef}
          type="file"
        />
      </div>
    </div>
  )
}

export function HousingComplexDocumentsSection({
  housingComplexId,
}: {
  housingComplexId: string
}) {
  const { data, isLoading } = useQuery(
    housingComplexFilesOptions(housingComplexId),
  )
  const uploadMutation = useUploadHousingComplexFile(housingComplexId)
  const deleteMutation = useDeleteHousingComplexFile(housingComplexId)

  const filesByKey = new Map<string, HousingComplexFile>()
  for (const file of data?.items ?? []) {
    filesByKey.set(file.documentTypeKey, file)
  }

  const busy = uploadMutation.isPending || deleteMutation.isPending

  async function handleUpload(documentTypeKey: string, file: File) {
    try {
      await uploadMutation.mutateAsync({ documentTypeKey, file })
      toast.success('Documento anexado ao conjunto.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel anexar o documento.',
      )
    }
  }

  async function handleRemove(fileId: string) {
    try {
      await deleteMutation.mutateAsync(fileId)
      toast.success('Documento removido do conjunto.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel remover o documento.',
      )
    }
  }

  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div className="grid gap-0.5">
        <span className="text-sm font-semibold text-foreground">
          Documentos do conjunto
        </span>
        <span className="text-xs text-muted-foreground">
          Anexados uma vez aqui e exibidos no checklist de todos os processos
          deste conjunto.
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando documentos...</p>
      ) : (
        <div className="grid gap-2">
          {CONJUNTO_DOC_TYPES.map((type) => {
            const file = filesByKey.get(type.key)
            return (
              <DocRow
                busy={busy}
                file={file}
                key={type.key}
                label={type.label}
                onRemove={() => (file ? handleRemove(file.id) : undefined)}
                onUpload={(selected) => handleUpload(type.key, selected)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
