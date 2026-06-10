import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { StatusBadge } from '@/shared/components/status-badge'
import { useReanalyzeCaixaOwner } from '../services/caixa-owner.mutations'
import { caixaAnalysesOptions } from '../services/caixa-owner.queries'
import { ownerTypeLabels } from '../services/processes.service'
import { CaixaOwnerEvidenceDialog } from './caixa-owner-evidence-dialog'

type Tone = 'error' | 'ghost' | 'info' | 'success' | 'warning'

const statusMeta: Record<string, { tone: Tone; label: string }> = {
  processing: { tone: 'info', label: 'Analisando contrato Caixa...' },
  done: { tone: 'success', label: 'Analise concluida' },
  review: { tone: 'warning', label: 'Revisar manualmente' },
  error: { tone: 'error', label: 'Falha na analise' },
}

function ownerTypeLabel(ownerType: string): string {
  return (
    (ownerTypeLabels as Record<string, string>)[ownerType] || ownerType || '—'
  )
}

type CaixaOwnerCardProps = {
  processId: string
  status: string
  ownerType: string
  ownerTypeSource: string
}

export function CaixaOwnerCard({
  processId,
  status,
  ownerType,
  ownerTypeSource,
}: CaixaOwnerCardProps) {
  const analysesQ = useQuery(caixaAnalysesOptions(processId))
  const latest = analysesQ.data?.items[0]
  const reanalyze = useReanalyzeCaixaOwner(processId)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  // Status desconhecido (ex.: enum novo no backend ainda nao mapeado): nao
  // renderiza feedback enganoso — esconde o card em vez de cair em "Revisar".
  const meta = statusMeta[status]
  if (!meta) {
    return null
  }
  const busy = status === 'processing' || reanalyze.isPending

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">Contrato Caixa</span>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          </div>
          <p className="text-muted-foreground text-sm">
            Titular: {ownerTypeLabel(ownerType)} ·{' '}
            {ownerTypeSource === 'system'
              ? 'definido pela analise'
              : 'definido manualmente'}
          </p>
          {status === 'review' ? (
            <p className="text-amber-600 text-sm">
              A analise nao teve certeza. Confira o titular ao editar o
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
        <CaixaOwnerEvidenceDialog
          analysisId={latest.id}
          onClose={() => setEvidenceOpen(false)}
          processId={processId}
        />
      ) : null}
    </Card>
  )
}
