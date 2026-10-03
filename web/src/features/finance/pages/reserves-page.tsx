import { useQuery } from '@tanstack/react-query'
import { ArrowDownUp, Paperclip, Undo2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Textarea } from '#/components/ui/textarea'
import { useSession } from '@/features/auth/hooks/use-session'
import { AttachmentsPanel } from '../components/attachments-panel'
import { AppDialog } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  EmptyState,
  ErrorState,
  FieldError,
  FinanceSection,
  LoadingState,
  Money,
} from '../components/finance-ui'
import {
  formatCents,
  formatCivilDate,
  parseBRLToCents,
  todayCivil,
} from '../lib/finance-money'
import { financeAccess, natureLabels } from '../lib/finance-labels'
import {
  useCreateReserveDebit,
  useReverseReserveMovement,
} from '../services/finance.mutations'
import {
  reserveMovementsQuery,
  reservesQuery,
} from '../services/finance.queries'
import {
  newIdempotencyKey,
  type ReserveBalance,
} from '../services/finance.service'

const kindLabels: Record<string, string> = {
  CONSTITUICAO: 'Constituição',
  DESPESA: 'Gasto efetivo',
  TRANSFERENCIA: 'Transferência',
}

/** P10: saldo próprio por reserva; gasto reduz a reserva, não a receita. */
export function ReservesPage() {
  const { permissions } = useSession()
  const balances = useQuery(reservesQuery())
  const [poolKey, setPoolKey] = useState<string | undefined>()
  const movements = useQuery(reserveMovementsQuery(poolKey))
  const [debitFor, setDebitFor] = useState<ReserveBalance | null>(null)
  const reverse = useReverseReserveMovement()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reversing, setReversing] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Provisões e reservas constituídas nos fechamentos. Gastos e transferências reduzem o saldo da reserva e nunca deduzem a receita de novo."
        eyebrow="Pagamentos"
        title="Reservas e saldos"
      />
      {balances.isPending ? <LoadingState /> : null}
      {balances.isError ? (
        <ErrorState error={balances.error} onRetry={() => balances.refetch()} />
      ) : null}
      {balances.data?.length === 0 ? (
        <EmptyState
          description="Reservas nascem de regras de provisão/reserva quando um lote é fechado."
          title="Nenhuma reserva constituída"
        />
      ) : null}
      {balances.data && balances.data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {balances.data.map((pool) => (
            <FinanceSection
              action={
                financeAccess.reservas(permissions) && pool.balanceCents > 0 ? (
                  <Button
                    onClick={() => setDebitFor(pool)}
                    size="sm"
                    variant="outline"
                  >
                    <ArrowDownUp className="size-4" />
                    Movimentar
                  </Button>
                ) : null
              }
              description={natureLabels[pool.nature]}
              key={pool.poolKey}
              title={pool.poolLabel}
            >
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Provisionado</dt>
                <dd className="text-right">
                  <Money cents={pool.constitutedCents} />
                </dd>
                <dt className="text-muted-foreground">Gasto efetivo</dt>
                <dd className="text-right">
                  <Money cents={-pool.spentCents} />
                </dd>
                <dt className="text-muted-foreground">Transferido</dt>
                <dd className="text-right">
                  <Money cents={-pool.transferredCents} />
                </dd>
                <dt className="font-medium">Saldo</dt>
                <dd className="text-right">
                  <Money cents={pool.balanceCents} strong />
                </dd>
              </dl>
              <Button
                className="mt-2 px-0"
                onClick={() => setPoolKey(pool.poolKey)}
                size="sm"
                variant="link"
              >
                Ver movimentos
              </Button>
            </FinanceSection>
          ))}
        </div>
      ) : null}

      <FinanceSection
        action={
          poolKey ? (
            <Button
              onClick={() => setPoolKey(undefined)}
              size="sm"
              variant="ghost"
            >
              Todas
            </Button>
          ) : null
        }
        title={`Movimentos${poolKey ? ` — ${balances.data?.find((p) => p.poolKey === poolKey)?.poolLabel ?? ''}` : ''}`}
      >
        {movements.isPending ? <LoadingState rows={2} /> : null}
        {movements.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem movimentos.</p>
        ) : null}
        {movements.data && movements.data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Reserva</TableHead>
                  <TableHead>Movimento</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.data.map(
                  ({ movement, processCode, closingCode }) => (
                    <Fragment key={movement.id}>
                      <TableRow
                        className={
                          movement.status === 'ESTORNADO' ? 'opacity-60' : ''
                        }
                      >
                      <TableCell className="text-sm">
                        {formatCivilDate(movement.movementDate)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {movement.poolLabel}
                      </TableCell>
                      <TableCell className="text-sm">
                        {kindLabels[movement.kind]}
                        {movement.status === 'ESTORNADO' ? (
                          <StatusBadge className="ml-2" tone="ghost">
                            estornado
                          </StatusBadge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {movement.description}
                        {closingCode ? ` · ${closingCode}` : ''}
                        {processCode ? ` · ${processCode}` : ''}
                        {movement.destination
                          ? ` · destino: ${movement.destination}`
                          : ''}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          cents={
                            movement.kind === 'CONSTITUICAO'
                              ? movement.amountCents
                              : -movement.amountCents
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            onClick={() =>
                              setExpanded(
                                expanded === movement.id ? null : movement.id,
                              )
                            }
                            size="sm"
                            variant="ghost"
                          >
                            <Paperclip className="size-4" />
                            Comprovantes
                          </Button>
                          {movement.kind !== 'CONSTITUICAO' &&
                          movement.status === 'ATIVO' &&
                          financeAccess.estornar(permissions) ? (
                            <Button
                              onClick={() => {
                                setExpanded(movement.id)
                                setReversing(movement.id)
                                setReverseReason('')
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              <Undo2 className="size-4" />
                              Estornar
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded === movement.id ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <div className="grid gap-4 py-2">
                            <AttachmentsPanel
                              canUpload={
                                financeAccess.reservas(permissions) &&
                                movement.status === 'ATIVO'
                              }
                              ownerId={movement.id}
                              ownerKind="reserve"
                            />
                            {reversing === movement.id ? (
                              <div className="grid gap-2 rounded-md border border-border p-3">
                                <Label htmlFor={`reserve-reverse-${movement.id}`}>
                                  Motivo do estorno
                                </Label>
                                <Textarea
                                  id={`reserve-reverse-${movement.id}`}
                                  onChange={(event) =>
                                    setReverseReason(event.target.value)
                                  }
                                  rows={2}
                                  value={reverseReason}
                                />
                                <div className="flex justify-end gap-2">
                                  <Button
                                    onClick={() => {
                                      setReversing(null)
                                      setReverseReason('')
                                    }}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    Cancelar
                                  </Button>
                                  <Button
                                    disabled={
                                      reverseReason.trim().length < 3 ||
                                      reverse.isPending
                                    }
                                    onClick={() =>
                                      reverse.mutate(
                                        {
                                          id: movement.id,
                                          reason: reverseReason,
                                        },
                                        {
                                          onSuccess: () => {
                                            toast.success(
                                              'Movimento estornado; histórico preservado.',
                                            )
                                            setReversing(null)
                                            setReverseReason('')
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
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    </Fragment>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </FinanceSection>

      {debitFor ? (
        <DebitDialog onClose={() => setDebitFor(null)} pool={debitFor} />
      ) : null}
    </div>
  )
}

function DebitDialog({
  pool,
  onClose,
}: {
  pool: ReserveBalance
  onClose: () => void
}) {
  const mutation = useCreateReserveDebit()
  const movements = useQuery(reserveMovementsQuery(pool.poolKey))
  const processes = [
    ...new Map(
      (movements.data ?? [])
        .filter(
          (m) => m.movement.processId && m.movement.kind === 'CONSTITUICAO',
        )
        .map((m) => [m.movement.processId as string, m.processCode ?? '']),
    ),
  ]
  const unique = (movements.data ?? []).some((m) => m.movement.uniquePerProcess)
  const [kind, setKind] = useState<'DESPESA' | 'TRANSFERENCIA'>('DESPESA')
  const [processId, setProcessId] = useState('')
  const [amount, setAmount] = useState('')
  const [movementDate, setMovementDate] = useState(todayCivil())
  const [description, setDescription] = useState('')
  const [destination, setDestination] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [idempotencyKey] = useState(newIdempotencyKey)
  function submit() {
    setError(null)
    const cents = parseBRLToCents(amount)
    if (!cents) return setError('Informe o valor.')
    if (cents > pool.balanceCents)
      return setError(
        `Valor acima do saldo (${formatCents(pool.balanceCents)}).`,
      )
    if (unique && !processId)
      return setError('Esta reserva é por processo: selecione o processo.')
    if (description.trim().length < 3)
      return setError('Informe a origem/justificativa.')
    if (!movementDate) return setError('Informe a data do movimento.')
    if (movementDate > todayCivil())
      return setError('A data do movimento não pode ser futura.')
    if (kind === 'TRANSFERENCIA' && destination.trim().length < 2)
      return setError('Informe o destino da transferência.')
    mutation.mutate(
      {
        idempotencyKey,
        poolKey: pool.poolKey,
        processId: processId || null,
        kind,
        amountCents: cents,
        movementDate,
        description,
        destination: destination || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Movimento registrado.')
          onClose()
        },
      },
    )
  }
  return (
    <AppDialog
      description={`Saldo atual ${formatCents(pool.balanceCents)}. Movimentos acima do saldo são recusados.`}
      footer={
        <Button disabled={mutation.isPending} onClick={submit}>
          Registrar
        </Button>
      }
      icon={ArrowDownUp}
      maxWidth="md"
      onClose={onClose}
      open
      title={`Movimentar — ${pool.poolLabel}`}
    >
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="debit-kind">Tipo</Label>
          <NativeSelect
            id="debit-kind"
            onChange={(e) => setKind(e.target.value as typeof kind)}
            value={kind}
          >
            <NativeSelectOption value="DESPESA">
              Gasto efetivo
            </NativeSelectOption>
            <NativeSelectOption value="TRANSFERENCIA">
              Transferência de saldo
            </NativeSelectOption>
          </NativeSelect>
        </div>
        {processes.length > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="debit-process">
              Processo{unique ? '' : ' (opcional)'}
            </Label>
            <NativeSelect
              id="debit-process"
              onChange={(e) => setProcessId(e.target.value)}
              value={processId}
            >
              <NativeSelectOption value="">
                {unique ? 'Selecione…' : 'Toda a reserva'}
              </NativeSelectOption>
              {processes.map(([id, code]) => (
                <NativeSelectOption key={id} value={id}>
                  {code}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="debit-amount">Valor (R$)</Label>
          <Input
            id="debit-amount"
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            value={amount}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="debit-date">Data</Label>
          <Input
            id="debit-date"
            max={todayCivil()}
            onChange={(e) => setMovementDate(e.target.value)}
            type="date"
            value={movementDate}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="debit-desc">Origem/justificativa</Label>
          <Textarea
            id="debit-desc"
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            value={description}
          />
        </div>
        {kind === 'TRANSFERENCIA' ? (
          <div className="grid gap-1.5">
            <Label htmlFor="debit-dest">Destino</Label>
            <Input
              id="debit-dest"
              onChange={(e) => setDestination(e.target.value)}
              value={destination}
            />
          </div>
        ) : null}
        <FieldError message={error} />
      </div>
    </AppDialog>
  )
}
