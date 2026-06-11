import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { StatusBadge } from '@/shared/components/status-badge'
import { useReanalyzeProcuracaoConjunto } from '../services/procuracao-conjunto.mutations'
import {
  procuracaoAnalysesOptions,
  procuracaoAnalysisDetailOptions,
} from '../services/procuracao-conjunto.queries'
import { ProcuracaoConjuntoEvidenceDialog } from './procuracao-conjunto-evidence-dialog'

type Tone = 'error' | 'ghost' | 'info' | 'success' | 'warning'

const statusMeta: Record<string, { tone: Tone; label: string }> = {
  processing: { tone: 'info', label: 'Analisando procuracao...' },
  done: { tone: 'success', label: 'Analise concluida' },
  review: { tone: 'warning', label: 'Revisar conjunto' },
  error: { tone: 'error', label: 'Falha na analise' },
}

type Props = {
  processId: string
  status: string
  housingComplex: string
  housingComplexSource: string
}

export function ProcuracaoConjuntoCard({
  processId,
  status,
  housingComplex,
  housingComplexSource,
}: Props) {
  const analysesQ = useQuery(procuracaoAnalysesOptions(processId))
  const latest = analysesQ.data?.items[0]
  const reanalyze = useReanalyzeProcuracaoConjunto(processId)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  // O item da lista e um resumo (sem decision). Busca o detalhe da ultima
  // analise SO quando ha review, para distinguir divergencia de revisao comum.
  const detailQ = useQuery({
    ...procuracaoAnalysisDetailOptions(processId, latest?.id ?? ''),
    enabled: !!latest?.id && status === 'review',
  })

  const meta = statusMeta[status]
  if (!meta) {
    return null
  }
  const busy = status === 'processing' || reanalyze.isPending
  const decision = (detailQ.data?.analysis?.decision ?? {}) as {
    conjunto?: string | null
    divergence?: boolean
  }
  const isDivergence = status === 'review' && decision.divergence === true

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Conjunto (procuracao)</span>
            <StatusBadge tone={isDivergence ? 'warning' : meta.tone}>
              {isDivergence ? 'Divergencia' : meta.label}
            </StatusBadge>
          </div>
          <p className="text-muted-foreground text-sm">
            Conjunto: {housingComplex || '—'} ·{' '}
            {housingComplexSource === 'system'
              ? 'definido pela analise'
              : 'definido manualmente'}
          </p>
          {isDivergence && decision.conjunto ? (
            <p className="text-amber-600 text-sm">
              A procuracao indica "{decision.conjunto}" — confira o conjunto ao
              editar o processo.
            </p>
          ) : status === 'review' ? (
            <p className="text-amber-600 text-sm">
              A analise nao teve certeza. Confira o conjunto ao editar o
              processo.
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {latest ? (
            <Button
              onClick={() => setEvidenceOpen(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Ver evidencia
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => reanalyze.mutate()}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Reanalisar
          </Button>
        </div>
      </CardContent>

      {evidenceOpen && latest ? (
        <ProcuracaoConjuntoEvidenceDialog
          analysisId={latest.id}
          onClose={() => setEvidenceOpen(false)}
          processId={processId}
        />
      ) : null}
    </Card>
  )
}
