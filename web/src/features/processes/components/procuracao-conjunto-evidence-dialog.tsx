import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { procuracaoAnalysisDetailOptions } from '../services/procuracao-conjunto.queries'

type Outorgante = { nome?: string | null; cpf?: string | null }
// Evidencia process_derivation (v3): o conjunto vem do fato conjuntoMatch.
type ConjuntoMatchShape = {
  state?: string
  result?: string
  conjunto?: string | null
  matchedBy?: string
}
type InputShape = {
  facts?: {
    conjuntoMatch?: ConjuntoMatchShape
    outorgantes?: { state?: string; value?: Outorgante[] }
  }
}

type Props = {
  processId: string
  analysisId: string
  onClose: () => void
}

export function ProcuracaoConjuntoEvidenceDialog({
  processId,
  analysisId,
  onClose,
}: Props) {
  const detailQ = useQuery(
    procuracaoAnalysisDetailOptions(processId, analysisId),
  )
  const analysis = detailQ.data?.analysis
  const input = ((analysis as { input?: unknown })?.input ?? {}) as InputShape
  const conjuntoMatch = input.facts?.conjuntoMatch
  const outorgantes = input.facts?.outorgantes?.value ?? []
  const isMatch = conjuntoMatch?.result === 'match'

  return (
    <AppDialog
      icon={Sparkles}
      maxWidth="2xl"
      onClose={onClose}
      open
      title="Evidencia do conjunto (procuracao)"
      variant="info"
    >
      {detailQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando evidencia...</p>
      ) : analysis ? (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={isMatch ? 'success' : 'warning'}>
              {isMatch ? 'Conjunto identificado' : 'Em revisao'}
            </StatusBadge>
            {conjuntoMatch?.matchedBy && conjuntoMatch.matchedBy !== 'none' ? (
              <span className="text-muted-foreground">
                Casado por{' '}
                {conjuntoMatch.matchedBy === 'name+city'
                  ? 'nome + cidade'
                  : 'nome'}
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <span className="text-muted-foreground">Conjunto:</span>
              <span className="font-medium">
                {conjuntoMatch?.conjunto || '—'}
              </span>
            </div>

            {outorgantes.length > 0 ? (
              <div className="mt-3 grid gap-1 border-t border-border pt-3">
                <span className="text-muted-foreground">Outorgante(s):</span>
                {outorgantes.map((o) => (
                  <span key={`${o.nome ?? ''}-${o.cpf ?? ''}`}>
                    {o.nome || '—'}
                    {o.cpf ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · CPF {o.cpf}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="text-muted-foreground text-xs">
            Modelo: {analysis.model}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Evidencia nao encontrada.
        </p>
      )}
    </AppDialog>
  )
}
