import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  EmptyState,
  ErrorState,
  FinanceSection,
  LoadingState,
  Money,
} from '../components/finance-ui'
import { formatCivilDate, formatInstant } from '../lib/finance-money'
import { financeAccess } from '../lib/finance-labels'
import { useCreateClosing } from '../services/finance.mutations'
import { closingsQuery, receiptsQuery } from '../services/finance.queries'
import {
  type ClosingPreview,
  newIdempotencyKey,
  previewClosingRequest,
} from '../services/finance.service'

/** Finaliza rateios aprovados e transforma as parcelas em valores a pagar. */
export function ClosingsPage() {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const canClose = financeAccess.fechar(permissions)
  const closings = useQuery(closingsQuery())
  const ready = useQuery({
    ...receiptsQuery({ status: ['APTO'] }),
    enabled: canClose,
  })
  const [selected, setSelected] = useState<string[]>([])
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [preview, setPreview] = useState<ClosingPreview | null>(null)
  const [checking, setChecking] = useState(false)
  const create = useCreateClosing()
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)

  function resetIntent() {
    setPreview(null)
    setIdempotencyKey(newIdempotencyKey())
  }

  async function check() {
    setChecking(true)
    try {
      setPreview(
        await previewClosingRequest({
          receiptIds: selected,
          periodStart,
          periodEnd,
        }),
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Primeiro finalize o rateio conferido. Depois, dentro de cada rateio finalizado, registre os pagamentos realmente feitos para cada recebedor."
        eyebrow="Pagamentos"
        title="Rateios e pagamentos"
      />

      {canClose ? (
        <FinanceSection
          description="Só aparecem entradas cuja prévia já foi conferida e aprovada."
          title="1. Finalizar rateio"
        >
          {ready.isPending ? <LoadingState rows={2} /> : null}
          {ready.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma entrada está pronta para finalizar o rateio.
            </p>
          ) : null}
          {ready.data && ready.data.length > 0 ? (
            <div className="grid gap-4">
              <ul className="grid gap-1.5">
                {ready.data.map((receipt) => {
                  const id = `closing-pick-${receipt.id}`
                  return (
                    <li key={receipt.id}>
                      <label
                        className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
                        htmlFor={id}
                      >
                        <Checkbox
                          checked={selected.includes(receipt.id)}
                          id={id}
                          onCheckedChange={(checked) => {
                            resetIntent()
                            setSelected((current) =>
                              checked === true
                                ? [...current, receipt.id]
                                : current.filter((x) => x !== receipt.id),
                            )
                          }}
                        />
                        <span className="flex-1">
                          {receipt.processCode} · {receipt.clientName}
                          <span className="block text-xs text-muted-foreground">
                            {receipt.housingComplexName ?? '—'} · entrada em{' '}
                            {formatCivilDate(receipt.releaseDate)}
                          </span>
                        </span>
                        <Money cents={receipt.amountCents} />
                      </label>
                    </li>
                  )
                })}
              </ul>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="period-start">Período — início</Label>
                  <Input
                    id="period-start"
                    onChange={(e) => {
                      setPeriodStart(e.target.value)
                      resetIntent()
                    }}
                    type="date"
                    value={periodStart}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="period-end">Período — fim</Label>
                  <Input
                    id="period-end"
                    onChange={(e) => {
                      setPeriodEnd(e.target.value)
                      resetIntent()
                    }}
                    type="date"
                    value={periodEnd}
                  />
                </div>
                <Button
                  disabled={
                    selected.length === 0 ||
                    !periodStart ||
                    !periodEnd ||
                    checking
                  }
                  onClick={check}
                  variant="outline"
                >
                  {checking ? 'Conferindo…' : 'Conferir rateio'}
                </Button>
              </div>

              {preview ? (
                preview.canClose ? (
                  <Alert>
                    <Lock className="size-4" />
                    <AlertTitle>Rateio conferido e pronto para finalizar</AlertTitle>
                    <AlertDescription>
                      {preview.items.length} entrada(s), total recebido{' '}
                      <Money cents={preview.grossCents} strong />. Ao finalizar,
                      os valores ficam congelados e viram obrigações de
                      pagamento para cada recebedor.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <AlertTitle>O rateio ainda tem impedimentos</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 grid gap-1">
                        {preview.items
                          .filter((item) => item.issues.length > 0)
                          .map((item) => (
                            <li key={item.receiptId}>
                              {item.issues.join(' ')}
                            </li>
                          ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )
              ) : null}

              <div className="flex justify-end">
                <Button
                  disabled={!preview?.canClose || create.isPending}
                  onClick={() =>
                    create.mutate(
                      {
                        receiptIds: selected,
                        periodStart,
                        periodEnd,
                        idempotencyKey,
                      },
                      {
                        onSuccess: ({ closing }) => {
                          toast.success(`Rateio ${closing.code} finalizado.`)
                          navigate({
                            to: '/pagamentos/fechamentos/$closingId',
                            params: { closingId: closing.id },
                          })
                        },
                      },
                    )
                  }
                >
                  <Lock className="size-4" />
                  {create.isPending ? 'Finalizando…' : 'Finalizar rateio'}
                </Button>
              </div>
            </div>
          ) : null}
        </FinanceSection>
      ) : null}

      <FinanceSection
        description="Abra um rateio para ver quem tem a receber, quanto já foi pago e qual saldo continua aberto."
        title="2. Rateios finalizados e pagamentos"
      >
        {closings.isPending ? <LoadingState /> : null}
        {closings.isError ? (
          <ErrorState
            error={closings.error}
            onRetry={() => closings.refetch()}
          />
        ) : null}
        {closings.data?.length === 0 ? (
          <EmptyState title="Nenhum rateio finalizado ainda" />
        ) : null}
        {closings.data && closings.data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rateio</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Entradas</TableHead>
                  <TableHead className="text-right">Total recebido</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Finalizado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closings.data.map((closing) => (
                  <TableRow key={closing.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-primary"
                        params={{ closingId: closing.id }}
                        preload={false}
                        to="/pagamentos/fechamentos/$closingId"
                      >
                        {closing.code}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatCivilDate(closing.periodStart)} –{' '}
                      {formatCivilDate(closing.periodEnd)}
                    </TableCell>
                    <TableCell>{closing.receiptCount}</TableCell>
                    <TableCell className="text-right">
                      <Money cents={closing.grossCents} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={closing.status === 'ATIVO' ? 'success' : 'ghost'}
                      >
                        {closing.status === 'ATIVO' ? 'Ativo' : 'Estornado'}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatInstant(closing.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </FinanceSection>
    </div>
  )
}
