import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { useState } from 'react'
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
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import {
  EmptyState,
  ErrorState,
  FinanceSection,
  LoadingState,
  Money,
  StatPill,
} from '../components/finance-ui'
import { formatCivilDate } from '../lib/finance-money'
import { financeAccess, statementKindLabels } from '../lib/finance-labels'
import {
  complexOptionsQuery,
  overviewQuery,
  statementQuery,
  statementRecipientOptionsQuery,
} from '../services/finance.queries'
import {
  downloadAuthenticated,
  statementCsvUrl,
} from '../services/finance.service'

type FinanceOverviewSnapshot = {
  coverage: {
    receivedCents: number
    coveredCents: number
    projectedCents: number
  }
  credits: {
    dueCents: number
    paidCents: number
    balanceCents: number
  }
}

/** Histórico operacional: valores liberados, pagos, ajustes e saldo atual. */
export function StatementPage() {
  const { permissions } = useSession()
  const recipients = useQuery(statementRecipientOptionsQuery())
  const complexes = useQuery(complexOptionsQuery())
  const overview = useQuery(overviewQuery())
  const [recipientId, setRecipientId] = useState('')
  const [housingComplexId, setHousingComplexId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const filters = {
    recipientId: recipientId || undefined,
    housingComplexId: housingComplexId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }
  const query = useQuery(statementQuery(filters))
  const overviewData = overview.data as FinanceOverviewSnapshot | undefined
  const hasFilters = Boolean(recipientId || housingComplexId || dateFrom || dateTo)
  const hasCurrentActivity = (overviewData?.coverage.receivedCents ?? 0) > 0
  const hasPendingPreview = (overviewData?.coverage.projectedCents ?? 0) > 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Veja o que já foi efetivado no Financeiro e acompanhe o saldo atual."
        eyebrow="Financeiro"
        title="Histórico"
      >
        <div className="flex flex-wrap gap-2">
          {financeAccess.reservas(permissions) ? (
            <Button asChild variant="outline">
              <Link className="no-underline" preload={false} to="/pagamentos/reservas">
                Ver reservas
              </Link>
            </Button>
          ) : null}
          {financeAccess.exportar(permissions) ? (
            <Button
              onClick={() =>
                downloadAuthenticated(
                  statementCsvUrl(filters),
                  'historico-financeiro.csv',
                ).catch((error: Error) => toast.error(error.message))
              }
              variant="outline"
            >
              <Download className="size-4" />
              Exportar CSV
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {overviewData ? (
        <FinanceSection
          description="Resumo geral do Financeiro agora. Os filtros abaixo afetam somente os movimentos do histórico."
          title="Situação atual"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatPill
              cents={overviewData.coverage.receivedCents}
              label="Recebido"
              hint="Total que entrou"
            />
            <StatPill
              cents={overviewData.coverage.coveredCents}
              label="Coberto"
              hint="Já possui destino pelas regras"
            />
            <StatPill
              cents={overviewData.credits.dueCents}
              label="Liberado"
              hint="Já virou valor a pagar"
            />
            <StatPill
              cents={overviewData.credits.paidCents}
              label="Pago"
              hint="Pagamentos registrados"
            />
          </div>
        </FinanceSection>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="st-recipient">Recebedor</Label>
          <NativeSelect id="st-recipient" onChange={(e) => setRecipientId(e.target.value)} value={recipientId}>
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {(recipients.data ?? []).map((recipient) => (
              <NativeSelectOption key={recipient.id} value={recipient.id}>{recipient.name}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-complex">Condomínio</Label>
          <NativeSelect id="st-complex" onChange={(e) => setHousingComplexId(e.target.value)} value={housingComplexId}>
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {(complexes.data ?? []).map((complex) => (
              <NativeSelectOption key={complex.id} value={complex.id}>{complex.name}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-from">De</Label>
          <Input id="st-from" onChange={(e) => setDateFrom(e.target.value)} type="date" value={dateFrom} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-to">Até</Label>
          <Input id="st-to" onChange={(e) => setDateTo(e.target.value)} type="date" value={dateTo} />
        </div>
      </div>

      {query.isPending ? <LoadingState /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatPill cents={query.data.totals.openingCents} label="Saldo anterior" />
            <StatPill cents={query.data.totals.creditsCents} label="Liberado no período" />
            <StatPill cents={query.data.totals.paidCents} label="Pago no período" />
            <StatPill cents={query.data.totals.closingBalanceCents} label="Saldo a pagar" />
          </div>
          {query.data.entries.length === 0 ? (
            <EmptyState
              action={
                hasCurrentActivity ? (
                  <Button asChild variant="outline">
                    <Link className="no-underline" preload={false} to="/pagamentos">
                      Ver distribuição
                    </Link>
                  </Button>
                ) : undefined
              }
              description={
                hasFilters
                  ? 'Nenhuma movimentação efetivada para os filtros selecionados. A situação geral acima continua mostrando o Financeiro atual.'
                  : hasPendingPreview
                    ? 'Já existem valores previstos na Distribuição, mas ainda não houve liberação ou pagamento para registrar aqui.'
                    : hasCurrentActivity
                      ? 'Há entradas registradas, mas ainda não existem movimentos efetivados no histórico.'
                      : 'Nenhuma movimentação financeira foi registrada ainda.'
              }
              title="Sem movimentações efetivadas"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>O que aconteceu</TableHead>
                    <TableHead>Recebedor</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Movimento</TableHead>
                    <TableHead className="text-right">Saldo a receber</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.entries.map((entry) => (
                    <TableRow key={`${entry.kind}-${entry.creditId}-${entry.payoutId ?? entry.adjustmentId ?? ''}`}>
                      <TableCell className="whitespace-nowrap text-sm">{formatCivilDate(entry.date)}</TableCell>
                      <TableCell className="text-sm">{statementKindLabels[entry.kind]}<span className="block text-xs text-muted-foreground">{entry.description}</span></TableCell>
                      <TableCell className="text-sm">{entry.recipientName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <Link className="text-primary" params={{ receiptId: entry.receiptId }} preload={false} to="/pagamentos/recebimentos/$receiptId">{entry.processCode}</Link>{' '}· {entry.clientName} · {entry.housingComplexName ?? '—'}
                        <span className="block">Distribuição{' '}<Link className="text-primary" params={{ closingId: entry.closingId }} preload={false} to="/pagamentos/fechamentos/$closingId">{entry.closingCode}</Link></span>
                      </TableCell>
                      <TableCell className="text-right"><Money cents={entry.amountCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={entry.balanceCents} strong /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
