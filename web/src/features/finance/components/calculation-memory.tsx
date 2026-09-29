import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { cn } from '#/lib/utils'
import { formatBasisPoints, formatCents } from '../lib/finance-money'
import { natureLabels } from '../lib/finance-labels'
import { Money } from './finance-ui'

export type CalcStep = {
  order: number
  code: string
  kind: string
  description: string
  baseKey: string | null
  baseCents: number | null
  ruleId: string | null
  ruleVersion: number | null
  valueType: string | null
  basisPoints: number | null
  fixedCents: number | null
  formula: string
  exactCents: string | null
  rounding: string
  amountCents: number
  nature: string | null
  recipientId: string | null
  recipientName: string | null
  poolLabel: string | null
  isAllocation: boolean
  note: string | null
}

export type CalcBlock = { code: string; message: string; fix: string }

export type Calculation = {
  algorithmVersion: string
  clientRegistrationDate: string | null
  blocked: boolean
  blocks: CalcBlock[]
  steps: CalcStep[]
  warnings?: string[]
  totals: Record<string, number> | null
}

const roundingLabels: Record<string, string> = {
  EXATO: 'exato',
  MEIO_PARA_CIMA: 'arredondado (meio para cima)',
  MAIOR_RESTO: 'centavo residual (maior resto)',
  NAO_SE_APLICA: '',
}

/** P03: bloqueio com causa e caminho de correção. */
export function BlocksPanel({ blocks }: { blocks: CalcBlock[] }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>Cálculo bloqueado — nenhum valor foi inventado</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 grid gap-2">
          {blocks.map((block) => (
            <li key={`${block.code}-${block.message}`}>
              <span className="font-medium">{block.message}</span>
              <span className="block text-xs opacity-90">
                Como corrigir: {block.fix}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function sumByNature(steps: CalcStep[], nature: string) {
  return steps
    .filter((step) => step.isAllocation && step.nature === nature)
    .reduce((total, step) => total + step.amountCents, 0)
}

function destination(step: CalcStep) {
  return step.recipientName ?? step.poolLabel ?? step.description
}

/**
 * P02: primeiro explica o dinheiro em linguagem operacional; os códigos A–P e
 * detalhes do motor continuam disponíveis, mas ficam como auditoria técnica.
 */
export function CalculationMemory({
  calculation,
}: {
  calculation: Calculation
}) {
  const allocations = calculation.steps.filter(
    (step) => step.isAllocation && step.amountCents !== 0,
  )
  const gross = calculation.totals?.A ?? 0
  const provisions = sumByNature(allocations, 'PROVISAO')
  const reserves = sumByNature(allocations, 'RESERVA')
  const recipients = sumByNature(allocations, 'CREDITO')
  const allocated = provisions + reserves + recipients
  const difference = gross - allocated
  const balanced = difference === 0

  return (
    <div className="grid gap-5">
      <section className="grid gap-3" aria-label="Resumo do rateio">
        <div>
          <h3 className="text-sm font-semibold">Para onde foi o dinheiro</h3>
          <p className="text-xs text-muted-foreground">
            A conferência principal é simples: tudo o que entrou precisa estar
            destinado a uma pessoa, empresa, provisão ou reserva.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <FlowValue label="Entrou" cents={gross} strong />
          <FlowValue label="Provisões" cents={provisions} />
          <FlowValue label="Reservas" cents={reserves} />
          <FlowValue label="Pessoas e empresas" cents={recipients} />
        </div>

        <div
          className={cn(
            'flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
            balanced
              ? 'border-emerald-500/35 bg-emerald-500/5'
              : 'border-destructive/50 bg-destructive/5',
          )}
        >
          <div>
            <div className="text-sm font-medium">Conferência do rateio</div>
            <div className="text-xs text-muted-foreground">
              Entrou {formatCents(gross)} · destinado {formatCents(allocated)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {balanced ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="size-4 text-destructive" />
            )}
            <span className="text-sm font-semibold tabular-nums">
              Diferença <Money cents={difference} />
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-2">
        <div>
          <h3 className="text-sm font-semibold">Destino de cada parcela</h3>
          <p className="text-xs text-muted-foreground">
            Aqui está a lista operacional de quem recebe ou para qual reserva o
            valor foi separado.
          </p>
        </div>
        {allocations.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            Nenhuma parcela foi destinada.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {allocations.map((step) => (
              <li
                className="grid gap-1 rounded-md border border-border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={`${step.order}-${step.code}`}
              >
                <div className="min-w-0">
                  <div className="font-medium">{destination(step)}</div>
                  <div className="text-xs text-muted-foreground">
                    {step.nature
                      ? natureLabels[step.nature] ?? step.nature
                      : 'Destino'}
                    {step.formula ? ` · ${step.formula}` : ''}
                    {step.basisPoints !== null &&
                    step.basisPoints !== undefined &&
                    step.valueType === 'PERCENTUAL'
                      ? ` · ${formatBasisPoints(step.basisPoints)}`
                      : ''}
                  </div>
                  {step.note ? (
                    <span className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <CircleAlert className="size-3" /> {step.note}
                    </span>
                  ) : null}
                </div>
                <Money cents={step.amountCents} className="sm:text-right" strong />
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-lg border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
          Memória técnica do cálculo
          <ChevronDown className="size-4 text-muted-foreground" />
        </summary>
        <div className="border-t border-border p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Detalhes A–P, fórmula, versão da regra e arredondamento. Use esta
            área para auditoria; ela não é necessária para a operação diária.
          </p>
          <ol className="grid gap-1.5">
            {calculation.steps.map((step) => (
              <li
                className={cn(
                  'grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-3 py-2 text-sm',
                  step.isAllocation
                    ? 'border-border'
                    : 'border-primary/30 bg-primary/5 font-medium',
                )}
                key={step.order}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {step.code}
                </span>
                <span className="min-w-0">
                  {step.description}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {step.formula}
                    {step.ruleVersion ? ` · regra v${step.ruleVersion}` : ''}
                    {step.nature
                      ? ` · ${natureLabels[step.nature] ?? step.nature}`
                      : ''}
                    {step.basisPoints !== null &&
                    step.basisPoints !== undefined &&
                    step.valueType === 'PERCENTUAL'
                      ? ` · ${formatBasisPoints(step.basisPoints)}`
                      : ''}
                    {roundingLabels[step.rounding]
                      ? ` · ${roundingLabels[step.rounding]}`
                      : ''}
                  </span>
                </span>
                <Money
                  cents={step.amountCents}
                  className="text-right"
                  strong={!step.isAllocation}
                />
              </li>
            ))}
          </ol>
          {calculation.totals ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Auditoria: parcelas somam {formatCents(calculation.totals.A)}; saldo
              final {formatCents(calculation.totals.P)}. Motor{' '}
              {calculation.algorithmVersion}.
            </p>
          ) : null}
        </div>
      </details>
    </div>
  )
}

function FlowValue({
  label,
  cents,
  strong = false,
}: {
  label: string
  cents: number
  strong?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">
        <Money cents={cents} strong={strong} />
      </div>
    </div>
  )
}
