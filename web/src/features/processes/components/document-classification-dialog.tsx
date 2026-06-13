import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Sparkles,
} from 'lucide-react'
import { AppDialog } from '@/shared/components/app-dialog'
import { documentExtractionDetailOptions } from '../services/document-extraction.queries'

type Pagina = { pagina: number; tipo: string }
type Attached = { documentTypeKey: string; pageCount: number }
type Skipped = { documentTypeKey: string; reason: string }
type OutputShape = { paginas?: Pagina[] }
type DecisionShape = { attached?: Attached[]; skipped?: Skipped[] }
type InputShape = { totalPages?: number; classifiedPages?: number }

// Rotulos legiveis dos tipos que a IA classifica (espelha processes.documents.ts).
const docTypeLabels: Record<string, string> = {
  procuracao_advogado: 'Procuração para o advogado',
  rg_cpf_cnh: 'RG/CPF/CNH',
  comprovante_endereco: 'Comprovante de endereço',
  termo_entrega_recebimento_imovel: 'Termo de entrega/recebimento',
  declaracao_hipossuficiencia: 'Declaração de hipossuficiência',
  contrato_honorarios_advocaticios: 'Contrato de honorários',
  contrato_compra_venda: 'Contrato de compra e venda',
  rg_cpf_cnh_conjuge: 'RG/CPF/CNH do cônjuge',
  certidao_casamento: 'Certidão de casamento',
  certidao_obito: 'Certidão de óbito',
  nao_identificado: 'Não identificado',
}

function typeLabel(key: string): string {
  return docTypeLabels[key] ?? key
}

// Agrupa paginas consecutivas em faixas: [1,2,3,9] -> "1–3, 9".
function formatPages(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b)
  if (sorted.length === 0) {
    return '—'
  }

  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i]
      continue
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = sorted[i]
    prev = sorted[i]
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`)

  const prefix = sorted.length === 1 ? 'pág.' : 'págs.'
  return `${prefix} ${ranges.join(', ')}`
}

type GroupOutcome = {
  icon: typeof CheckCircle2
  tone: string
  status: string
  reason?: string
}

function outcomeFor(
  tipo: string,
  attachedKeys: Set<string>,
  skippedReason: Map<string, string>,
): GroupOutcome {
  if (tipo === 'nao_identificado') {
    return {
      icon: CircleSlash,
      tone: 'text-muted-foreground',
      status: 'não identificado — anexar manualmente em Outros se aplicável',
    }
  }
  if (attachedKeys.has(tipo)) {
    return { icon: CheckCircle2, tone: 'text-emerald-600', status: 'anexado' }
  }
  if (skippedReason.has(tipo)) {
    return {
      icon: AlertTriangle,
      tone: 'text-amber-600',
      status: 'não anexado',
      reason: skippedReason.get(tipo),
    }
  }
  return { icon: CircleSlash, tone: 'text-muted-foreground', status: '—' }
}

type DocumentClassificationDialogProps = {
  processId: string
  analysisId: string
  fileName: string
  onClose: () => void
}

export function DocumentClassificationDialog({
  processId,
  analysisId,
  fileName,
  onClose,
}: DocumentClassificationDialogProps) {
  const detailQ = useQuery(
    documentExtractionDetailOptions(processId, analysisId),
  )
  const analysis = detailQ.data?.analysis
  const output = (analysis?.output ?? {}) as OutputShape
  const decision = (analysis?.decision ?? {}) as DecisionShape
  const input = (analysis?.input ?? {}) as InputShape
  const paginas = output.paginas ?? []

  const attachedKeys = new Set(
    (decision.attached ?? []).map((item) => item.documentTypeKey),
  )
  const skippedReason = new Map(
    (decision.skipped ?? []).map((item) => [item.documentTypeKey, item.reason]),
  )

  // Agrupa por tipo preservando a ordem da primeira pagina de cada tipo.
  const pagesByType = new Map<string, number[]>()
  for (const p of paginas) {
    const pages = pagesByType.get(p.tipo) ?? []
    pages.push(p.pagina)
    pagesByType.set(p.tipo, pages)
  }

  const totalPages = input.totalPages ?? paginas.length
  const omitted = Math.max(
    0,
    totalPages - (input.classifiedPages ?? paginas.length),
  )

  return (
    <AppDialog
      icon={Sparkles}
      maxWidth="2xl"
      onClose={onClose}
      open
      title="Classificação dos documentos"
      description={`${fileName} · ${totalPages} página(s)`}
      variant="info"
    >
      {detailQ.isLoading ? (
        <p className="text-sm text-muted-foreground">
          Carregando classificação...
        </p>
      ) : analysis ? (
        <div className="grid gap-4 text-sm">
          {pagesByType.size === 0 ? (
            <p className="text-muted-foreground">
              Nenhuma página foi classificada.
            </p>
          ) : (
            <div className="grid gap-2">
              {Array.from(pagesByType.entries()).map(([tipo, pages]) => {
                const o = outcomeFor(tipo, attachedKeys, skippedReason)
                const Icon = o.icon
                return (
                  <div
                    className="flex items-start gap-3 rounded-lg border border-border p-3"
                    key={tipo}
                  >
                    <Icon className={`mt-0.5 size-4 shrink-0 ${o.tone}`} />
                    <div className="grid flex-1 gap-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{typeLabel(tipo)}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatPages(pages)}
                        </span>
                      </div>
                      <span className={`text-xs ${o.tone}`}>{o.status}</span>
                      {o.reason ? (
                        <span className="text-muted-foreground text-xs">
                          motivo: {o.reason}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {omitted > 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span className="text-amber-700 dark:text-amber-400">
                {omitted} página(s) não classificada(s) pela IA — revise o
                arquivo e anexe manualmente se necessário.
              </span>
            </div>
          ) : null}

          <div className="grid gap-1 border-border border-t pt-3 text-muted-foreground text-xs">
            <span>
              {attachedKeys.size} anexado(s) · {skippedReason.size} não
              anexado(s)
            </span>
            <span>Modelo: {analysis.model}</span>
            {analysis.tokensInput ? (
              <span>
                Tokens: {analysis.tokensInput} entrada /{' '}
                {analysis.tokensOutput ?? 0} saída
              </span>
            ) : null}
            <span>
              Origem:{' '}
              {analysis.triggerSource === 'system' ? 'automática' : 'manual'}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Classificação não encontrada.
        </p>
      )}
    </AppDialog>
  )
}
