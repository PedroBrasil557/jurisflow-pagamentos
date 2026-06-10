import { Loader2, TriangleAlert } from 'lucide-react'
import { Badge } from '#/components/ui/badge'

// Badge de estado da ingestao de documentos do processo (importar/escanear),
// para a lista: "processando" enquanto a IA le/organiza; "extracao falhou"
// quando ha documento em erro (reprocessavel no detalhe). Null = nada a mostrar.
export function ProcessIngestionBadge({
  status,
}: {
  status: 'processing' | 'error' | null
}) {
  if (status === 'processing') {
    return (
      <Badge
        className="w-fit gap-1 border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400"
        variant="outline"
      >
        <Loader2 className="size-3 animate-spin" />
        Processando documentos
      </Badge>
    )
  }

  if (status === 'error') {
    return (
      <Badge
        className="w-fit gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        variant="outline"
      >
        <TriangleAlert className="size-3" />
        Extracao falhou
      </Badge>
    )
  }

  return null
}
