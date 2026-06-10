import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { StatusBadge } from '@/shared/components/status-badge'
import { useReconsultarQuitacao } from '../services/caixa-quitacao.mutations'

type Tone = 'error' | 'ghost' | 'info' | 'success' | 'warning'

const statusMeta: Record<string, { tone: Tone; label: string; hint?: string }> =
  {
    pending: { tone: 'info', label: 'Consulta na fila...' },
    processing: { tone: 'info', label: 'Consultando na Caixa...' },
    quitado: {
      tone: 'success',
      label: 'Quitado',
      hint: 'Declaracao de Quitacao anexada automaticamente ao checklist.',
    },
    nao_encontrado: {
      tone: 'ghost',
      label: 'Sem contrato para quitacao',
    },
    erro: {
      tone: 'error',
      label: 'Falha na consulta',
      hint: 'Consulte manualmente no site da Caixa e anexe a declaracao.',
    },
  }

type CaixaQuitacaoCardProps = {
  processId: string
  status: string
  message?: string | null
}

export function CaixaQuitacaoCard({
  processId,
  status,
  message,
}: CaixaQuitacaoCardProps) {
  const reconsultar = useReconsultarQuitacao(processId)
  const meta = statusMeta[status]

  if (!meta) {
    return null
  }

  const busy =
    status === 'pending' || status === 'processing' || reconsultar.isPending

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Quitacao Caixa</span>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          </div>
          {meta.hint ? (
            <p
              className={
                status === 'erro'
                  ? 'text-amber-600 text-sm'
                  : 'text-muted-foreground text-sm'
              }
            >
              {meta.hint}
            </p>
          ) : null}
          {message ? (
            <p className="text-muted-foreground text-xs">{message}</p>
          ) : null}
        </div>

        <Button
          className="shrink-0"
          disabled={busy}
          onClick={() => reconsultar.mutate()}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Reconsultar
        </Button>
      </CardContent>
    </Card>
  )
}
