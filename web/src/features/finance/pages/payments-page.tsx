import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, ExternalLink, UserRound } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { PageHeader } from '@/shared/components/page-header'
import { SearchInput } from '@/shared/components/search-input'
import { StatusBadge } from '@/shared/components/status-badge'
import { getErrorMessage } from '@/shared/services/api-error'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  StatPill,
} from '../components/finance-ui'
import { creditsQuery } from '../services/finance.queries'

type RecipientSummary = {
  recipientId: string
  recipientName: string
  workTypes: string[]
  creditCount: number
  dueCents: number
  paidCents: number
  balanceCents: number
}

type PaymentRecipientsResponse = {
  items: RecipientSummary[]
  totals: {
    dueCents: number
    paidCents: number
    balanceCents: number
  }
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

async function fetchPaymentRecipients(search: string, page: number) {
  const url = new URL('/api/finance/payment-recipients', window.location.origin)
  if (search) url.searchParams.set('search', search)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', '30')
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Não foi possível carregar os pagamentos por recebedor.',
      ),
    )
  }
  return (await response.json()) as PaymentRecipientsResponse
}

function summaryTone(summary: RecipientSummary) {
  if (summary.balanceCents <= 0) return { label: 'Pago', tone: 'success' as const }
  if (summary.paidCents > 0)
    return { label: 'Parcial', tone: 'info' as const }
  return { label: 'A pagar', tone: 'warning' as const }
}

export function PaymentsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(search.trim())
  const query = useQuery({
    queryKey: ['finance', 'payment-recipients', deferredSearch, page],
    queryFn: () => fetchPaymentRecipients(deferredSearch, page),
  })

  const data = query.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Veja quanto cada recebedor tem direito, quanto já foi pago e qual valor ainda está pendente."
        eyebrow="Pagamentos"
        title="Pagamentos por recebedor"
      />

      {query.isPending ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill
              cents={data.totals.dueCents}
              label="Total devido"
              hint="Direito gerado pelos rateios finalizados"
            />
            <StatPill
              cents={data.totals.paidCents}
              label="Total pago"
              hint="Pagamentos já registrados"
            />
            <StatPill
              cents={data.totals.balanceCents}
              label="Ainda falta pagar"
              hint="Saldo aberto de todos os recebedores"
            />
          </div>

          <SearchInput
            aria-label="Buscar recebedor ou processo"
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Buscar por recebedor, função, processo, cliente ou condomínio"
            value={search}
          />

          {data.pagination.total === 0 ? (
            <EmptyState
              description={
                deferredSearch
                  ? 'Nenhum recebedor corresponde à busca.'
                  : 'Os valores a pagar aparecem aqui depois que um rateio é finalizado.'
              }
              icon={UserRound}
              title={deferredSearch ? 'Nenhum resultado' : 'Nenhum valor a pagar ainda'}
            />
          ) : null}

          {data.items.length > 0 ? (
            <div className="grid gap-3">
              {data.items.map((summary) => (
                <RecipientCard key={summary.recipientId} summary={summary} />
              ))}
            </div>
          ) : null}

          {data.pagination.totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {data.pagination.total} recebedor(es) · página{' '}
                {data.pagination.page} de {data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={data.pagination.page <= 1 || query.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  size="sm"
                  variant="outline"
                >
                  Anterior
                </Button>
                <Button
                  disabled={
                    data.pagination.page >= data.pagination.totalPages ||
                    query.isFetching
                  }
                  onClick={() =>
                    setPage((current) =>
                      Math.min(data.pagination.totalPages, current + 1),
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  Próxima
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function RecipientCard({ summary }: { summary: RecipientSummary }) {
  const [open, setOpen] = useState(false)
  const status = summaryTone(summary)
  const credits = useQuery({
    ...creditsQuery({ recipientId: summary.recipientId }),
    enabled: open,
  })

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{summary.recipientName}</h2>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.workTypes.length > 0
              ? summary.workTypes.join(' · ')
              : 'Recebedor financeiro'}
            {' · '}
            {summary.creditCount} valor(es) originado(s) em rateios
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="text-muted-foreground">Devido </span>
            <Money cents={summary.dueCents} strong />
          </span>
          <span>
            <span className="text-muted-foreground">Pago </span>
            <Money cents={summary.paidCents} />
          </span>
          <span>
            <span className="text-muted-foreground">Falta </span>
            <Money cents={summary.balanceCents} strong />
          </span>
          <Button
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            size="sm"
            variant="outline"
          >
            {open ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            {open ? 'Ocultar origem' : 'Ver origem'}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border">
          {credits.isPending ? <LoadingState /> : null}
          {credits.isError ? (
            <div className="p-4">
              <ErrorState
                error={credits.error}
                onRetry={() => credits.refetch()}
              />
            </div>
          ) : null}
          {credits.data ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Processo / cliente</TableHead>
                    <TableHead>Origem do valor</TableHead>
                    <TableHead className="text-right">Devido</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                    <TableHead className="w-32">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.data
                    .filter((credit) => credit.status !== 'ESTORNADO')
                    .map((credit) => {
                      const due = credit.amountCents + credit.adjustedCents
                      const balance = due - credit.paidCents
                      return (
                        <TableRow key={credit.id}>
                          <TableCell>
                            <div className="font-medium">{credit.processCode}</div>
                            <div className="text-xs text-muted-foreground">
                              {credit.clientName}
                              {credit.housingComplexName
                                ? ` · ${credit.housingComplexName}`
                                : ''}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {credit.workType || 'Rateio financeiro'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Money cents={due} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money cents={credit.paidCents} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money cents={balance} strong />
                          </TableCell>
                          <TableCell>
                            <Button asChild size="sm" variant="ghost">
                              <Link
                                params={{ closingId: credit.closingId }}
                                preload={false}
                                to="/pagamentos/fechamentos/$closingId"
                              >
                                <ExternalLink className="size-4" />
                                Abrir rateio
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
