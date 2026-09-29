import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Banknote, ChevronDown, Scale, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { useSession } from '@/features/auth/hooks/use-session'
import { AppDialog } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { AttachmentsPanel } from '../components/attachments-panel'
import {
  type Calculation,
  CalculationMemory,
} from '../components/calculation-memory'
import {
  BackLink,
  ErrorState,
  FieldError,
  FinanceSection,
  LoadingState,
  Money,
  Tone,
} from '../components/finance-ui'
import {
  formatCents,
  formatCivilDate,
  formatInstant,
  parseBRLToCents,
  todayCivil,
} from '../lib/finance-money'
import { creditStatusLabels, financeAccess } from '../lib/finance-labels'
import {
  useCreateAdjustment,
  useCreatePayout,
  useReverseClosing,
  useReversePayout,
} from '../services/finance.mutations'
import { closingQuery, payoutsQuery } from '../services/finance.queries'
import { type Credit, newIdempotencyKey } from '../services/finance.service'

export function ClosingDetailPage({ closingId }: { closingId: string }) {
  const { permissions } = useSession()
  const query = useQuery(closingQuery(closingId))
  const [payoutFor, setPayoutFor] = useState<Credit | null>(null)
  const [adjustFor, setAdjustFor] = useState<Credit | null>(null)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (query.isPending) return <LoadingState rows={8} />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const { closing, items, credits } = query.data
  const active = closing.status === 'ATIVO'

  return (
    <div className="flex flex-col gap-6">
      <BackLink label="Fechamentos" to="/pagamentos/fechamentos" />
      <PageHeader
        description={`Período ${formatCivilDate(closing.periodStart)} – ${formatCivilDate(closing.periodEnd)} · confirmado em ${formatInstant(closing.createdAt)} · motor ${closing.algorithmVersion}`}
        eyebrow="Pagamentos · fechamento"
        title={`Fechamento ${closing.code}`}
      >
        <div className="flex items-center gap-2">
          <StatusBadge tone={active ? 'success' : 'ghost'}>
            {active ? 'Fechado' : 'Estornado'}
          </StatusBadge>
          {active && financeAccess.estornar(permissions) ? (
            <Button onClick={() => setReverseOpen(true)} variant="ghost">
              <Undo2 className="size-4" />
              Estornar fechamento
            </Button>
          ) : null}
        </div>
      </PageHeader>
      {!active ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Estornado em {formatInstant(closing.reversedAt)}:{' '}
          {closing.reversalReason}. O histórico foi preservado.
        </p>
      ) : null}

      <FinanceSection
        description="Crédito = valor a receber. A baixa registra uma transferência já feita fora da plataforma."
        title="Créditos por recebedor"
      >
        {credits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem créditos visíveis neste fechamento.
          </p>
        ) : (
          <ul className="grid gap-2">
            {credits.map((credit) => {
              const due = credit.amountCents + credit.adjustedCents
              const balance = due - credit.paidCents
              return (
                <li className="rounded-lg border border-border" key={credit.id}>
                  <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{credit.recipientName}</div>
                      <div className="text-xs text-muted-foreground">
                        {credit.processCode} · {credit.clientName} · etapa{' '}
                        {credit.stepCode}
                        {credit.workType ? ` · ${credit.workType}` : ''} · regra
                        v{credit.ruleVersion}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span>
                        Devido <Money cents={due} strong />
                      </span>
                      <span>
                        Pago <Money cents={credit.paidCents} />
                      </span>
                      <span>
                        Saldo <Money cents={balance} strong />
                      </span>
                      <Tone map={creditStatusLabels} value={credit.status} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
                    {balance > 0 &&
                    credit.status !== 'ESTORNADO' &&
                    financeAccess.baixar(permissions) ? (
                      <Button onClick={() => setPayoutFor(credit)} size="sm">
                        <Banknote className="size-4" />
                        Registrar baixa
                      </Button>
                    ) : null}
                    {credit.status !== 'ESTORNADO' &&
                    financeAccess.estornar(permissions) ? (
                      <Button
                        onClick={() => setAdjustFor(credit)}
                        size="sm"
                        variant="ghost"
                      >
                        <Scale className="size-4" />
                        Ajuste
                      </Button>
                    ) : null}
                    <Button
                      aria-expanded={expanded === credit.id}
                      onClick={() =>
                        setExpanded(expanded === credit.id ? null : credit.id)
                      }
                      size="sm"
                      variant="ghost"
                    >
                      <ChevronDown className="size-4" />
                      Baixas
                    </Button>
                  </div>
                  {expanded === credit.id ? (
                    <PayoutList creditId={credit.id} />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </FinanceSection>

      <FinanceSection
        description="Memória congelada no fechamento (INV-07)."
        title="Itens do lote"
      >
        <div className="grid gap-4">
          {items.map((item) => {
            const snapshot = item.receiptSnapshot as {
              processCode?: string
              clientName?: string
              housingComplexName?: string
            }
            return (
              <details
                className="rounded-lg border border-border p-3"
                key={item.id}
              >
                <summary className="cursor-pointer text-sm font-medium">
                  <Link
                    className="text-primary"
                    params={{ receiptId: item.receiptId }}
                    preload={false}
                    to="/pagamentos/recebimentos/$receiptId"
                  >
                    {snapshot.processCode}
                  </Link>{' '}
                  · {snapshot.clientName} · {snapshot.housingComplexName ?? '—'}
                  {item.isActive ? '' : ' (estornado)'}
                </summary>
                <div className="mt-3">
                  <CalculationMemory
                    calculation={item.calculation as Calculation}
                  />
                </div>
              </details>
            )
          })}
        </div>
      </FinanceSection>

      {payoutFor ? (
        <PayoutDialog credit={payoutFor} onClose={() => setPayoutFor(null)} />
      ) : null}
      {adjustFor ? (
        <AdjustmentDialog
          credit={adjustFor}
          onClose={() => setAdjustFor(null)}
        />
      ) : null}
      {reverseOpen ? (
        <ReverseClosingDialog
          closingId={closing.id}
          onClose={() => setReverseOpen(false)}
        />
      ) : null}
    </div>
  )
}

function PayoutList({ creditId }: { creditId: string }) {
  const { permissions } = useSession()
  const query = useQuery(payoutsQuery(creditId))
  const reverse = useReversePayout()
  const [reversing, setReversing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  if (query.isPending)
    return (
      <div className="p-3">
        <LoadingState rows={1} />
      </div>
    )
  if (!query.data?.length) {
    return (
      <p className="border-t border-border p-3 text-sm text-muted-foreground">
        Nenhuma baixa registrada.
      </p>
    )
  }
  return (
    <ul className="grid gap-2 border-t border-border p-3">
      {query.data.map(({ payout }) => (
        <li
          className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm"
          key={payout.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {formatCivilDate(payout.paidOn)} ·{' '}
              <Money cents={payout.amountCents} strong /> · ref.{' '}
              {payout.reference}
              <span className="block text-xs text-muted-foreground">
                Saldo após a baixa: {formatCents(payout.balanceAfterCents)}
                {payout.status === 'ESTORNADO'
                  ? ` · estornada: ${payout.reversalReason}`
                  : ''}
              </span>
            </span>
            {payout.status === 'ATIVO' &&
            financeAccess.estornar(permissions) ? (
              <Button
                onClick={() => setReversing(payout.id)}
                size="sm"
                variant="ghost"
              >
                <Undo2 className="size-4" />
                Estornar
              </Button>
            ) : (
              <StatusBadge
                tone={payout.status === 'ATIVO' ? 'success' : 'ghost'}
              >
                {payout.status === 'ATIVO' ? 'Ativa' : 'Estornada'}
              </StatusBadge>
            )}
          </div>
          <AttachmentsPanel
            canUpload={
              financeAccess.baixar(permissions) && payout.status === 'ATIVO'
            }
            ownerId={payout.id}
            ownerKind="payout"
          />
          {reversing === payout.id ? (
            <div className="grid gap-2">
              <Label htmlFor={`rev-${payout.id}`}>Motivo do estorno</Label>
              <Textarea
                id={`rev-${payout.id}`}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                value={reason}
              />
              <Button
                className="justify-self-end"
                disabled={reason.trim().length < 3 || reverse.isPending}
                onClick={() =>
                  reverse.mutate(
                    { id: payout.id, reason },
                    {
                      onSuccess: () => {
                        toast.success('Baixa estornada; histórico preservado.')
                        setReversing(null)
                        setReason('')
                      },
                    },
                  )
                }
                size="sm"
                variant="destructive"
              >
                Confirmar estorno
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function PayoutDialog({
  credit,
  onClose,
}: {
  credit: Credit
  onClose: () => void
}) {
  const mutation = useCreatePayout()
  const balance = credit.amountCents + credit.adjustedCents - credit.paidCents
  const [amount, setAmount] = useState(formatCents(balance).replace('R$ ', ''))
  const [paidOn, setPaidOn] = useState(todayCivil())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(newIdempotencyKey)
  function submit() {
    setError(null)
    const amountCents = parseBRLToCents(amount)
    if (!amountCents || amountCents <= 0)
      return setError('Informe um valor maior que zero.')
    if (amountCents > balance)
      return setError(`O valor excede o saldo de ${formatCents(balance)}.`)
    if (!reference.trim())
      return setError(
        'Informe a referência da transferência (ex.: ID do PIX/TED).',
      )
    mutation.mutate(
      {
        idempotencyKey,
        creditId: credit.id,
        amountCents,
        paidOn,
        reference,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          toast.success(
            amountCents === balance
              ? 'Baixa total registrada.'
              : 'Baixa parcial registrada.',
          )
          onClose()
        },
      },
    )
  }
  return (
    <AppDialog
      description={`${credit.recipientName} · saldo ${formatCents(balance)}. A plataforma apenas registra o pagamento feito fora dela.`}
      footer={
        <Button disabled={mutation.isPending} onClick={submit}>
          Registrar baixa
        </Button>
      }
      icon={Banknote}
      maxWidth="md"
      onClose={onClose}
      open
      title="Registrar baixa"
      variant="success"
    >
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="payout-amount">
            Valor efetivamente transferido (R$)
          </Label>
          <Input
            id="payout-amount"
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            value={amount}
          />
          <p className="text-xs text-muted-foreground">
            Menor que o saldo = baixa parcial.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="payout-date">Data efetiva</Label>
          <Input
            id="payout-date"
            max={todayCivil()}
            onChange={(e) => setPaidOn(e.target.value)}
            type="date"
            value={paidOn}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="payout-ref">Referência</Label>
          <Input
            id="payout-ref"
            onChange={(e) => setReference(e.target.value)}
            value={reference}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="payout-notes">Observações</Label>
          <Textarea
            id="payout-notes"
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            value={notes}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          O comprovante é anexado na baixa, depois de registrada.
        </p>
        <FieldError message={error} />
      </div>
    </AppDialog>
  )
}

function AdjustmentDialog({
  credit,
  onClose,
}: {
  credit: Credit
  onClose: () => void
}) {
  const mutation = useCreateAdjustment()
  const [amount, setAmount] = useState('')
  const [negative, setNegative] = useState(true)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(newIdempotencyKey)
  return (
    <AppDialog
      description="Evento corretivo auditável: o crédito original não é editado."
      footer={
        <Button
          disabled={mutation.isPending}
          onClick={() => {
            const cents = parseBRLToCents(amount)
            if (!cents) return setError('Informe o valor do ajuste.')
            if (reason.trim().length < 3) return setError('Informe o motivo.')
            mutation.mutate(
              {
                idempotencyKey,
                creditId: credit.id,
                amountCents: negative ? -cents : cents,
                reason,
              },
              {
                onSuccess: () => {
                  toast.success('Ajuste registrado.')
                  onClose()
                },
              },
            )
          }}
        >
          Registrar ajuste
        </Button>
      }
      icon={Scale}
      maxWidth="md"
      onClose={onClose}
      open
      title={`Ajuste — ${credit.recipientName}`}
      variant="warning"
    >
      <div className="grid gap-3">
        <div
          className="flex gap-2"
          role="radiogroup"
          aria-label="Direção do ajuste"
        >
          <Button
            aria-checked={negative}
            onClick={() => setNegative(true)}
            role="radio"
            size="sm"
            variant={negative ? 'default' : 'outline'}
          >
            Reduzir devido
          </Button>
          <Button
            aria-checked={!negative}
            onClick={() => setNegative(false)}
            role="radio"
            size="sm"
            variant={!negative ? 'default' : 'outline'}
          >
            Aumentar devido
          </Button>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="adj-amount">Valor (R$)</Label>
          <Input
            id="adj-amount"
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            value={amount}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="adj-reason">Motivo</Label>
          <Textarea
            id="adj-reason"
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            value={reason}
          />
        </div>
        <FieldError message={error} />
      </div>
    </AppDialog>
  )
}

function ReverseClosingDialog({
  closingId,
  onClose,
}: {
  closingId: string
  onClose: () => void
}) {
  const mutation = useReverseClosing()
  const [reason, setReason] = useState('')
  return (
    <AppDialog
      description="Créditos e reservas do lote são estornados e os recebimentos voltam para prévia. Exige que nenhuma baixa esteja ativa e que a reserva não tenha sido consumida."
      footer={
        <Button
          disabled={reason.trim().length < 3 || mutation.isPending}
          onClick={() =>
            mutation.mutate(
              { id: closingId, reason },
              {
                onSuccess: () => {
                  toast.success('Fechamento estornado.')
                  onClose()
                },
              },
            )
          }
          variant="destructive"
        >
          Estornar
        </Button>
      }
      icon={Undo2}
      maxWidth="md"
      onClose={onClose}
      open
      title="Estornar fechamento"
      variant="destructive"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="rev-closing">Motivo</Label>
        <Textarea
          id="rev-closing"
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          value={reason}
        />
      </div>
    </AppDialog>
  )
}
