import { AlertTriangle, CircleAlert } from 'lucide-react'
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

/** P02: cada número com sua origem (base, regra/versão, fórmula, arredondamento). */
export function CalculationMemory({
  calculation,
}: {
  calculation: Calculation
}) {
  const recipients = new Map<string, { name: string; cents: number }>()
  for (const step of calculation.steps) {
    if (!step.isAllocation || step.amountCents === 0) continue
    const key = step.recipientName ?? `Reserva: ${step.poolLabel}`
    const current = recipients.get(key) ?? { name: key, cents: 0 }
    current.cents += step.amountCents
    recipients.set(key, current)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid gap-2">
        <h3 className="text-sm font-medium">De onde vem cada valor</h3>
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
                {step.note ? (
                  <span className="mt-1 flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400">
                    <CircleAlert className="size-3" /> {step.note}
                  </span>
                ) : null}
              </span>
              <Money
                cents={step.amountCents}
                className="text-right"
                strong={!step.isAllocation}
              />
            </li>
          ))}
        </ol>
      </div>
      <div className="grid content-start gap-2">
        <h3 className="text-sm font-medium">Destino por recebedor e reserva</h3>
        <ul className="grid gap-1.5">
          {[...recipients.values()].map((entry) => (
            <li
              className="flex justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              key={entry.name}
            >
              <span className="min-w-0 truncate">{entry.name}</span>
              <Money cents={entry.cents} />
            </li>
          ))}
        </ul>
        {calculation.totals ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Conferência: parcelas somam {formatCents(calculation.totals.A)}{' '}
            (receita total); saldo final {formatCents(calculation.totals.P)}.
            Motor {calculation.algorithmVersion}.
          </p>
        ) : null}
      </div>
    </div>
  )
}
