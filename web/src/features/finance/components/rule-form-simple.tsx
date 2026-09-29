import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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
import { stageLabels } from '../lib/finance-labels'
import {
  complexOptionsQuery,
  recipientsQuery,
} from '../services/finance.queries'
import type { RulePayload } from '../services/finance.service'
import { FieldError } from './finance-ui'

type Props = {
  submitLabel: string
  pending?: boolean
  onSubmit: (payload: RulePayload) => void
}

type Purpose = RulePayload['stage']

const options: Array<{
  stage: Purpose
  title: string
  description: string
  nature: RulePayload['nature']
}> = [
  {
    stage: 'PROVISAO_RECEITA',
    title: 'Separar uma provisão do valor recebido',
    description: 'Ex.: tributos. O valor é separado antes dos demais rateios.',
    nature: 'PROVISAO',
  },
  {
    stage: 'DEDUCAO_LIQUIDA',
    title: 'Pagar alguém sobre a receita líquida',
    description: 'Ex.: profissional recebe 4% depois da provisão inicial.',
    nature: 'CREDITO',
  },
  {
    stage: 'RESERVA',
    title: 'Criar uma reserva para uma finalidade',
    description: 'Ex.: certidão. A reserva ganha saldo próprio e movimentos.',
    nature: 'RESERVA',
  },
  {
    stage: 'PARTICIPACAO_RESULTADO',
    title: 'Pagar participação depois das deduções',
    description: 'Ex.: parceiro recebe uma parcela do resultado intermediário.',
    nature: 'CREDITO',
  },
  {
    stage: 'DISTRIBUICAO_FINAL',
    title: 'Distribuir o saldo final',
    description: 'Define quem recebe o valor que restou no fim do rateio.',
    nature: 'CREDITO',
  },
]

export function SimpleRuleForm({ submitLabel, pending, onSubmit }: Props) {
  const recipients = useQuery(recipientsQuery())
  const complexes = useQuery(complexOptionsQuery())
  const [stage, setStage] = useState<Purpose>('DEDUCAO_LIQUIDA')
  const selected = useMemo(
    () => options.find((option) => option.stage === stage) ?? options[1],
    [stage],
  )
  const nature = selected.nature
  const isCredit = nature === 'CREDITO'

  const [recipientId, setRecipientId] = useState('')
  const [poolLabel, setPoolLabel] = useState('')
  const [workType, setWorkType] = useState('')
  const [valueType, setValueType] = useState<RulePayload['valueType']>('PERCENTUAL')
  const [valueText, setValueText] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [sortOrder, setSortOrder] = useState('0')
  const [uniqueness, setUniqueness] = useState<'NENHUMA' | 'UNICA_POR_PROCESSO'>('NENHUMA')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [complexIds, setComplexIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function selectPurpose(next: Purpose) {
    setStage(next)
    setValueText('')
    setNotConfigured(false)
    setRecipientId('')
    setPoolLabel('')
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
          return setError('Informe um percentual válido, por exemplo 4 ou 2,5. O valor 0 é aceito.')
      } else {
        fixedCents = parseBRLToCents(valueText)
        if (fixedCents === null)
          return setError('Informe um valor válido, por exemplo 500,00. O valor 0 é aceito.')
      }
    }

    if (isCredit && !recipientId)
      return setError('Selecione quem receberá este valor.')
    if (!isCredit && !poolLabel.trim())
      return setError('Dê um nome para a provisão ou reserva.')
    if (!validFrom) return setError('Informe quando esta regra começa a valer.')
    if (complexIds.length === 0)
      return setError('Escolha pelo menos um condomínio para esta regra.')

    const order = Number(sortOrder)
    if (!Number.isInteger(order) || order < 0)
      return setError('A ordem de aplicação deve ser um número inteiro a partir de zero.')

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
    <form className="grid gap-6" noValidate onSubmit={submit}>
      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold">1. O que esta regra deve fazer?</h3>
          <p className="text-xs text-muted-foreground">
            Escolha pelo significado financeiro. Os códigos internos do motor ficam escondidos na operação diária.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {options.map((option) => {
            const active = option.stage === stage
            return (
              <button
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                key={option.stage}
                onClick={() => selectPurpose(option.stage)}
                type="button"
              >
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Base usada pelo sistema: <strong>{stageLabels[stage]?.base}</strong>.{' '}
          {stageLabels[stage]?.help}
        </div>
      </section>

      <section className="grid gap-4">
        <h3 className="text-sm font-semibold">2. Para quem ou para onde vai o valor?</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {isCredit ? (
            <div className="grid gap-1.5">
              <Label htmlFor="simple-rule-recipient">Quem recebe</Label>
              <NativeSelect
                id="simple-rule-recipient"
                onChange={(e) => setRecipientId(e.target.value)}
                value={recipientId}
              >
                <NativeSelectOption value="">Selecione…</NativeSelectOption>
                {(recipients.data ?? [])
                  .filter((recipient) => recipient.isActive)
                  .map((recipient) => (
                    <NativeSelectOption key={recipient.id} value={recipient.id}>
                      {recipient.name}
                      {recipient.document ? ` · ${recipient.document}` : ''}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="simple-rule-pool">Nome da {nature === 'RESERVA' ? 'reserva' : 'provisão'}</Label>
              <Input
                id="simple-rule-pool"
                onChange={(e) => setPoolLabel(e.target.value)}
                placeholder={nature === 'RESERVA' ? 'Ex.: Reserva de certidão' : 'Ex.: Provisão tributária'}
                value={poolLabel}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="simple-rule-work">Motivo / função</Label>
            <Input
              id="simple-rule-work"
              onChange={(e) => setWorkType(e.target.value)}
              placeholder="Ex.: Apoio administrativo, parceiro, certidão"
              value={workType}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <h3 className="text-sm font-semibold">3. Quanto será destinado?</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="simple-rule-value-type">Forma de cálculo</Label>
            <NativeSelect
              disabled={stage === 'DISTRIBUICAO_FINAL'}
              id="simple-rule-value-type"
              onChange={(e) => {
                setValueType(e.target.value as RulePayload['valueType'])
                setValueText('')
              }}
              value={valueType}
            >
              <NativeSelectOption value="PERCENTUAL">Percentual</NativeSelectOption>
              <NativeSelectOption value="VALOR_FIXO">Valor fixo</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="simple-rule-value">
              {valueType === 'PERCENTUAL' ? 'Percentual (%)' : 'Valor (R$)'}
            </Label>
            <Input
              disabled={notConfigured}
              id="simple-rule-value"
              inputMode="decimal"
              onChange={(e) => setValueText(e.target.value)}
              placeholder="0,00"
              value={valueText}
            />
            <p className="text-xs text-muted-foreground">
              0 é um valor válido. Só deixe pendente se a regra ainda não foi definida.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <h3 className="text-sm font-semibold">4. Quando e onde esta regra vale?</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="simple-rule-from">Válida a partir de</Label>
            <Input
              id="simple-rule-from"
              onChange={(e) => setValidFrom(e.target.value)}
              type="date"
              value={validFrom}
            />
            <p className="text-xs text-muted-foreground">
              A seleção usa a data de cadastro do cliente.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="simple-rule-to">Válida até (opcional)</Label>
            <Input
              id="simple-rule-to"
              onChange={(e) => setValidTo(e.target.value)}
              type="date"
              value={validTo}
            />
          </div>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Condomínios</legend>
          <div className="flex gap-2">
            <Button
              onClick={() => setComplexIds((complexes.data ?? []).map((complex) => complex.id))}
              size="xs"
              type="button"
              variant="outline"
            >
              Marcar todos
            </Button>
            <Button onClick={() => setComplexIds([])} size="xs" type="button" variant="ghost">
              Limpar
            </Button>
          </div>
          <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            {(complexes.data ?? []).map((complex) => {
              const id = `simple-rule-complex-${complex.id}`
              return (
                <label className="flex items-center gap-2 text-sm" htmlFor={id} key={complex.id}>
                  <Checkbox
                    checked={complexIds.includes(complex.id)}
                    id={id}
                    onCheckedChange={(checked) =>
                      setComplexIds((current) =>
                        checked === true
                          ? [...current, complex.id]
                          : current.filter((value) => value !== complex.id),
                      )
                    }
                  />
                  {complex.name}
                </label>
              )
            })}
            {complexes.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum condomínio cadastrado. Cadastre um condomínio antes de criar a regra.
              </p>
            ) : null}
          </div>
        </fieldset>
      </section>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Opções avançadas
        </summary>
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="simple-rule-order">Ordem de aplicação</Label>
            <Input
              id="simple-rule-order"
              inputMode="numeric"
              onChange={(e) => setSortOrder(e.target.value)}
              value={sortOrder}
            />
            <p className="text-xs text-muted-foreground">
              Use 0 para a primeira regra da mesma etapa, 1 para a próxima e assim por diante.
            </p>
          </div>
          {stage === 'RESERVA' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="simple-rule-unique">Quando a reserva é criada?</Label>
              <NativeSelect
                id="simple-rule-unique"
                onChange={(e) => setUniqueness(e.target.value as typeof uniqueness)}
                value={uniqueness}
              >
                <NativeSelectOption value="NENHUMA">Em todo recebimento</NativeSelectOption>
                <NativeSelectOption value="UNICA_POR_PROCESSO">Uma vez por processo</NativeSelectOption>
              </NativeSelect>
            </div>
          ) : null}
          <label className="flex items-start gap-2 text-sm sm:col-span-2" htmlFor="simple-rule-pending">
            <Checkbox
              checked={notConfigured}
              id="simple-rule-pending"
              onCheckedChange={(checked) => setNotConfigured(checked === true)}
            />
            <span>
              Valor ainda não definido
              <span className="block text-xs text-muted-foreground">
                Esta opção bloqueia cálculos futuros até que o percentual ou valor seja informado.
              </span>
            </span>
          </label>
        </div>
      </details>

      <div className="grid gap-1.5">
        <Label htmlFor="simple-rule-notes">Observações</Label>
        <Textarea
          id="simple-rule-notes"
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
