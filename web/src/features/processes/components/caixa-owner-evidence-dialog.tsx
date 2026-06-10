import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { caixaAnalysisDetailOptions } from '../services/caixa-owner.queries'

type Comprador = { nome?: string; cpf?: string | null; trechoFonte?: string }
type ByDoc = { documentKey?: string; compradores?: Comprador[] }
type DecisionShape = { result?: string; matchedBy?: string }
type OutputShape = { byDoc?: ByDoc[] }

const docLabels: Record<string, string> = {
  termo_entrega_recebimento_imovel: 'Termo de entrega/recebimento',
  declaracao_quitacao: 'Declaracao de quitacao',
}

type CaixaOwnerEvidenceDialogProps = {
  processId: string
  analysisId: string
  onClose: () => void
}

export function CaixaOwnerEvidenceDialog({
  processId,
  analysisId,
  onClose,
}: CaixaOwnerEvidenceDialogProps) {
  const detailQ = useQuery(caixaAnalysisDetailOptions(processId, analysisId))
  const analysis = detailQ.data?.analysis
  const decision = (analysis?.decision ?? {}) as DecisionShape
  const output = (analysis?.output ?? {}) as OutputShape
  const byDoc = output.byDoc ?? []

  return (
    <AppDialog
      icon={Sparkles}
      maxWidth="2xl"
      onClose={onClose}
      open
      title="Evidencia da analise do contrato Caixa"
      variant="info"
    >
      {detailQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando evidencia...</p>
      ) : analysis ? (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={decision.result === 'titular' ? 'success' : 'warning'}
            >
              {decision.result === 'titular' ? 'Titular' : 'Revisar'}
            </StatusBadge>
            {decision.matchedBy && decision.matchedBy !== 'none' ? (
              <span className="text-muted-foreground">
                Conferido por {decision.matchedBy === 'cpf' ? 'CPF' : 'nome'}
              </span>
            ) : null}
          </div>

          {byDoc.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhum dado extraido dos termos.
            </p>
          ) : (
            <div className="grid gap-3">
              {byDoc.map((doc, docIndex) => (
                <div
                  className="rounded-lg border border-border p-3"
                  key={`${doc.documentKey}-${docIndex}`}
                >
                  <p className="font-medium">
                    {docLabels[doc.documentKey ?? ''] ?? doc.documentKey}
                  </p>
                  {(doc.compradores ?? []).length === 0 ? (
                    <p className="mt-1 text-muted-foreground">
                      Nenhum comprador lido neste termo.
                    </p>
                  ) : (
                    <ul className="mt-2 grid gap-2">
                      {(doc.compradores ?? []).map((comprador, buyerIndex) => (
                        <li
                          className="grid gap-0.5"
                          key={`${comprador.nome}-${buyerIndex}`}
                        >
                          <span className="font-medium">{comprador.nome}</span>
                          <span className="text-muted-foreground">
                            CPF: {comprador.cpf ?? '—'}
                          </span>
                          {comprador.trechoFonte ? (
                            <span className="text-xs text-muted-foreground italic">
                              "{comprador.trechoFonte}"
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-1 border-border border-t pt-3 text-muted-foreground text-xs">
            <span>Modelo: {analysis.model}</span>
            {analysis.tokensInput ? (
              <span>
                Tokens: {analysis.tokensInput} entrada /{' '}
                {analysis.tokensOutput ?? 0} saida
              </span>
            ) : null}
            <span>
              Origem:{' '}
              {analysis.triggerSource === 'system' ? 'automatica' : 'manual'}
            </span>
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
