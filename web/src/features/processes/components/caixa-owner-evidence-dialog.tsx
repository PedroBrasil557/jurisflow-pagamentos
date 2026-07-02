import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { AppDialog } from '@/shared/components/app-dialog'
import { StatusBadge } from '@/shared/components/status-badge'
import { caixaAnalysisDetailOptions } from '../services/caixa-owner.queries'

type Person = { nome?: string; cpf?: string }
// Evidencia process_derivation (v3): a decisao do tipo de proprietario + os fatos.
type DecisionShape = {
  ownerType?: { value?: string; origin?: string; reason?: string }
  quitacaoSubject?: Person | null
}
type FactShape = { state?: string; value?: Person[] }
type InputShape = {
  facts?: { termoCompradores?: FactShape; titularProcesso?: FactShape }
}

const ownerTypeLabels: Record<string, string> = {
  titular_contrato_caixa: 'Titular do contrato Caixa',
  nao_titular_contrato_caixa: 'Nao titular do contrato Caixa',
}

function PersonRow({
  label,
  nome,
  cpf,
}: {
  label: string
  nome?: string | null
  cpf?: string | null
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span>
        {nome || '—'}
        {cpf ? (
          <span className="text-muted-foreground"> · CPF {cpf}</span>
        ) : null}
      </span>
    </div>
  )
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
  const input = ((analysis as { input?: unknown })?.input ?? {}) as InputShape
  const ownerType = decision.ownerType
  const isTitular = ownerType?.value === 'titular_contrato_caixa'
  const isConcluido = ownerType?.origin === 'derived'
  const compradores = input.facts?.termoCompradores?.value ?? []

  return (
    <AppDialog
      icon={Sparkles}
      maxWidth="2xl"
      onClose={onClose}
      open
      title="Evidencia do tipo de proprietario"
      variant="info"
    >
      {detailQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando evidencia...</p>
      ) : analysis ? (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={isConcluido ? (isTitular ? 'success' : 'info') : 'warning'}
            >
              {ownerType?.value
                ? (ownerTypeLabels[ownerType.value] ?? ownerType.value)
                : 'Em revisao'}
            </StatusBadge>
          </div>

          {ownerType?.reason ? (
            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs">Motivo</span>
              <span>{ownerType.reason}</span>
            </div>
          ) : null}

          {compradores.length > 0 ? (
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium">Compradores do termo</p>
              <div className="mt-2 grid gap-1">
                {compradores.map((p, i) => (
                  <PersonRow
                    cpf={p.cpf}
                    key={`${p.cpf ?? ''}-${p.nome ?? ''}`}
                    label={i === 0 ? 'Titular' : 'Co-comprador'}
                    nome={p.nome}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {decision.quitacaoSubject ? (
            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs">
                Consulta de quitacao
              </span>
              <PersonRow
                cpf={decision.quitacaoSubject.cpf}
                label="Titular Caixa"
                nome={decision.quitacaoSubject.nome}
              />
            </div>
          ) : null}

          <div className="grid gap-1 border-border border-t pt-3 text-muted-foreground text-xs">
            <span>Modelo: {analysis.model}</span>
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
