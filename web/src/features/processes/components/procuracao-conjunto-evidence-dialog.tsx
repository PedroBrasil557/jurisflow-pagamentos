import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { procuracaoAnalysisDetailOptions } from '../services/procuracao-conjunto.queries'

type DecisionShape = {
  result?: string
  matchedBy?: string
  conjunto?: string | null
  apply?: boolean
  divergence?: boolean
}
type Outorgante = { nome?: string | null; cpf?: string | null }
type OutputShape = {
  outorgantes?: Outorgante[]
  endereco?: string | null
  cidade?: string | null
  trechoFonte?: string | null
  ownerConfirmed?: boolean
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
  const decision = (analysis?.decision ?? {}) as DecisionShape
  const output = (analysis?.output ?? {}) as OutputShape
  const outorgantes = output.outorgantes ?? []

  return (
    <AppDialog
      icon={Sparkles}
      maxWidth="2xl"
      onClose={onClose}
      open
      title="Evidencia da analise da procuracao"
      variant="info"
    >
      {detailQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando evidencia...</p>
      ) : analysis ? (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={
                decision.divergence
                  ? 'warning'
                  : decision.result === 'match'
                    ? 'success'
                    : 'warning'
              }
            >
              {decision.divergence
                ? 'Divergencia'
                : decision.result === 'match'
                  ? 'Conjunto identificado'
                  : 'Revisar'}
            </StatusBadge>
            {decision.matchedBy && decision.matchedBy !== 'none' ? (
              <span className="text-muted-foreground">
                Casado por{' '}
                {decision.matchedBy === 'name+city' ? 'nome + cidade' : 'nome'}
              </span>
            ) : null}
            {output.ownerConfirmed === false ? (
              <span className="text-amber-600">
                Outorgante nao confere com o titular do processo
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <span className="text-muted-foreground">Conjunto:</span>
              <span className="font-medium">{decision.conjunto || '—'}</span>
              <span className="text-muted-foreground">Endereco:</span>
              <span>{output.endereco || '—'}</span>
              <span className="text-muted-foreground">Cidade:</span>
              <span>{output.cidade || '—'}</span>
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

            {output.trechoFonte ? (
              <p className="mt-3 border-t border-border pt-3 text-muted-foreground italic">
                "{output.trechoFonte}"
              </p>
            ) : null}
          </div>

          <div className="text-muted-foreground text-xs">
            Modelo: {analysis.model} · Tokens: {analysis.tokensInput ?? 0}{' '}
            entrada / {analysis.tokensOutput ?? 0} saida
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
