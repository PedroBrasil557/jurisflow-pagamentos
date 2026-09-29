import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import {
  parseBRLToCents,
  parsePercentToBasisPoints,
} from '../lib/finance-money'
import {
  natureLabels,
  stageLabels,
  stageNatures,
  stageOrder,
} from '../lib/finance-labels'
import {
  complexOptionsQuery,
  recipientsQuery,
} from '../services/finance.queries'
import type { RulePayload } from '../services/finance.service'
import { FieldError } from './finance-ui'

export type RuleFormInitial = Partial<RulePayload> & { lockIdentity?: boolean }

type Props = {
  initial?: RuleFormInitial
  submitLabel: string
  pending?: boolean
  onSubmit: (payload: RulePayload) => void
}

function formatPercentInput(bps: number | null | undefined) {
  if (bps === null || bps === undefined) return ''
  return (bps / 100).toFixed(2).replace('.', ',')
}

function formatMoneyInput(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** P04B: cadastro de regra/versão. 0% é válido; "não configurado" é explícito. */
export function RuleForm({ initial, submitLabel, pending, onSubmit }: Props) {
  const recipients = useQuery(recipientsQuery())
  const complexes = useQuery(complexOptionsQuery())
  const [stage, setStage] = useState<RulePayload['stage']>(
    initial?.stage ?? 'DEDUCAO_LIQUIDA',
  )
  const [nature, setNature] = useState<RulePayload['nature']>(
    initial?.nature ?? (stageNatures[stage]?.[0] as RulePayload['nature']),
  )
  const [recipientId, setRecipientId] = useState(initial?.recipientId ?? '')
  const [poolLabel, setPoolLabel] = useState(initial?.poolLabel ?? '')
  const [workType, setWorkType] = useState(initial?.workType ?? '')
  const [valueType, setValueType] = useState<RulePayload['valueType']>(
    initial?.valueType ?? 'PERCENTUAL',
  )
  const [valueText, setValueText] = useState(
    initial?.valueType === 'VALOR_FIXO'
      ? formatMoneyInput(initial?.fixedCents)
      : formatPercentInput(initial?.basisPoints),
  )
  const [notConfigured, setNotConfigured] = useState(
    initial !== undefined &&
      (initial.valueType === 'VALOR_FIXO'
        ? initial.fixedCents === null
        : initial.basisPoints === null),
  )
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0))
  const [uniqueness, setUniqueness] = useState<
    NonNullable<RulePayload['uniqueness']>
  >(initial?.uniqueness ?? 'NENHUMA')
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? '')
  const [validTo, setValidTo] = useState(initial?.validTo ?? '')
  const [complexIds, setComplexIds] = useState<string[]>(
    initial?.housingComplexIds ?? [],
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const locked = Boolean(initial?.lockIdentity)
  const natures = stageNatures[stage] ?? []
  const isCredit = nature === 'CREDITO'

  function changeStage(next: RulePayload['stage']) {
    setStage(next)
    const allowed = stageNatures[next] ?? []
    if (!allowed.includes(nature))
      setNature(allowed[0] as RulePayload['nature'])
    if (next === 'DISTRIBUICAO_FINAL') setValueType('PERCENTUAL')
    if (next !== 'RESERVA') setUniqueness('NENHUMA')
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    let basisPoints: number | null = null
    let fixedCents: number | null = null
    if (!notConfigured) {
      if (valueType === 'PERCENTUAL') {
        basisPoints = parsePercentToBasisPoints(valueText)
        if (basisPoints === null)
          return setError('Percentual inválido (ex.: 2,5 ou 0).')
      } else {
        fixedCents = parseBRLToCents(valueText)
        if (fixedCents === null)
          return setError('Valor inválido (ex.: 500,00 ou 0).')
      }
    }
    if (isCredit && !recipientId) return setError('Selecione o recebedor.')
    if (!isCredit && !poolLabel.trim())
      return setError('Informe o nome da reserva/provisão.')
    if (!validFrom) return setError('Informe o início da vigência.')
    if (complexIds.length === 0)
      return setError('Vincule pelo menos um condomínio.')
    const order = Number(sortOrder)
    if (!Number.isInteger(order) || order < 0)
      return setError('Ordem inválida.')
    onSubmit({
      stage,
      nature,
      recipientId: isCredit ? recipientId : null,
      poolLabel: isCredit ? null : poolLabel.trim(),
      workType: workType.trim(),
      valueType,
      basisPoints: valueType === 'PERCENTUAL' ? basisPoints : null,
      fixedCents: valueType === 'VALOR_FIXO' ? fixedCents : null,
      sortOrder: order,
      uniqueness,
      validFrom,
      validTo: validTo || null,
      housingComplexIds: complexIds,
      notes: notes.trim() || undefined,
    })
  }

  return (
    <form className="grid gap-4" noValidate onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="rule-stage">Etapa (base de cálculo)</Label>
          <NativeSelect
            disabled={locked}
            id="rule-stage"
            onChange={(e) =>
              changeStage(e.target.value as RulePayload['stage'])
            }
            value={stage}
          >
            {stageOrder.map((key) => (
              <NativeSelectOption key={key} value={key}>
                {stageLabels[key]?.label} — {stageLabels[key]?.base}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-nature">Natureza</Label>
          <NativeSelect
            disabled={locked || natures.length === 1}
            id="rule-nature"
            onChange={(e) => setNature(e.target.value as RulePayload['nature'])}
            value={nature}
          >
            {natures.map((key) => (
              <NativeSelectOption key={key} value={key}>
                {natureLabels[key]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {isCredit ? (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-recipient">Recebedor</Label>
            <NativeSelect
              disabled={locked}
              id="rule-recipient"
              onChange={(e) => setRecipientId(e.target.value)}
              value={recipientId}
            >
              <NativeSelectOption value="">Selecione…</NativeSelectOption>
              {(recipients.data ?? [])
                .filter((r) => r.isActive || r.id === recipientId)
                .map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {r.name}
                    {r.document ? ` · ${r.document}` : ''}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-pool">Reserva/provisão</Label>
            <Input
              disabled={locked}
              id="rule-pool"
              onChange={(e) => setPoolLabel(e.target.value)}
              placeholder="Ex.: Tributos, Certidão"
              value={poolLabel}
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="rule-work">Trabalho/função</Label>
          <Input
            disabled={locked}
            id="rule-work"
            onChange={(e) => setWorkType(e.target.value)}
            placeholder="Opcional"
            value={workType}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-value-type">Tipo de valor</Label>
          <NativeSelect
            disabled={stage === 'DISTRIBUICAO_FINAL'}
            id="rule-value-type"
            onChange={(e) => {
              setValueType(e.target.value as RulePayload['valueType'])
              setValueText('')
            }}
            value={valueType}
          >
            <NativeSelectOption value="PERCENTUAL">
              Percentual
            </NativeSelectOption>
            <NativeSelectOption value="VALOR_FIXO">
              Valor fixo
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-value">
            {valueType === 'PERCENTUAL' ? 'Percentual (%)' : 'Valor (R$)'}
          </Label>
          <Input
            disabled={notConfigured}
            id="rule-value"
            inputMode="decimal"
            onChange={(e) => setValueText(e.target.value)}
            placeholder={valueType === 'PERCENTUAL' ? '0,00' : '0,00'}
            value={valueText}
          />
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor="rule-not-configured"
          >
            <Checkbox
              checked={notConfigured}
              id="rule-not-configured"
              onCheckedChange={(checked) => setNotConfigured(checked === true)}
            />
            Ainda não configurado (bloqueia cálculos até ser informado; 0 é um
            valor válido)
          </label>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-order">Ordem na etapa</Label>
          <Input
            id="rule-order"
            inputMode="numeric"
            onChange={(e) => setSortOrder(e.target.value)}
            value={sortOrder}
          />
        </div>
        {stage === 'RESERVA' ? (
          <div className="grid gap-1.5">
            <Label htmlFor="rule-unique">Unicidade</Label>
            <NativeSelect
              disabled={locked}
              id="rule-unique"
              onChange={(e) =>
                setUniqueness(e.target.value as typeof uniqueness)
              }
              value={uniqueness}
            >
              <NativeSelectOption value="NENHUMA">
                Em todo recebimento
              </NativeSelectOption>
              <NativeSelectOption value="UNICA_POR_PROCESSO">
                Única por processo
              </NativeSelectOption>
            </NativeSelect>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="rule-from">
            Vigência início (data de cadastro do cliente)
          </Label>
          <Input
            id="rule-from"
            onChange={(e) => setValidFrom(e.target.value)}
            type="date"
            value={validFrom}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-to">Vigência fim (opcional)</Label>
          <Input
            id="rule-to"
            onChange={(e) => setValidTo(e.target.value)}
            type="date"
            value={validTo ?? ''}
          />
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          Condomínios vinculados
        </legend>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              setComplexIds((complexes.data ?? []).map((c) => c.id))
            }
            size="xs"
            type="button"
            variant="outline"
          >
            Marcar todos
          </Button>
          <Button
            onClick={() => setComplexIds([])}
            size="xs"
            type="button"
            variant="ghost"
          >
            Limpar
          </Button>
        </div>
        <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
          {(complexes.data ?? []).map((complex) => {
            const id = `rule-complex-${complex.id}`
            return (
              <label
                className="flex items-center gap-2 text-sm"
                htmlFor={id}
                key={complex.id}
              >
                <Checkbox
                  checked={complexIds.includes(complex.id)}
                  id={id}
                  onCheckedChange={(checked) =>
                    setComplexIds((current) =>
                      checked === true
                        ? [...current, complex.id]
                        : current.filter((c) => c !== complex.id),
                    )
                  }
                />
                {complex.name}
              </label>
            )
          })}
          {complexes.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum condomínio cadastrado.
            </p>
          ) : null}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="rule-notes">Observações</Label>
        <Textarea
          id="rule-notes"
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          value={notes}
        />
      </div>

      <FieldError message={error} />
      <div className="flex justify-end">
        <Button disabled={pending} type="submit">
          {pending ? 'Salvando…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
