import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
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
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import { SearchInput } from '@/shared/components/search-input'
import { StatusBadge } from '@/shared/components/status-badge'
import { getErrorMessage } from '@/shared/services/api-error'
import {
  EmptyState,
  ErrorState,
  FinanceSection,
  LoadingState,
  Money,
  StatPill,
} from '../components/finance-ui'
import {
  formatBasisPoints,
  formatCents,
  formatCivilDate,
} from '../lib/finance-money'
import type { AllocationPolicy } from '../services/finance-quick.service'
import {
  allocationPolicyQuery,
  creditsQuery,
} from '../services/finance.queries'

type RecipientSummary = {
  recipientId: string
  recipientName: string
  workTypes: string[]
  creditCount: number
  plannedCents: number
  releasedCents: number
  paidCents: number
  balanceCents: number
  awaitingDistributionCents: number
}

type PaymentRecipientsResponse = {
  items: RecipientSummary[]
  totals: {
    plannedCents: number
    releasedCents: number
    paidCents: number
    balanceCents: number
    awaitingDistributionCents: number
  }
  preview: {
    pendingReceipts: number
    inconsistent: boolean
    inconsistentReceipts: number
  }
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

async function fetchPaymentRecipients(search: string, page: number) {
  const url = new URL(
    '/api/finance/payment-recipients-preview',
    window.location.origin,
  )
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
  if (summary.awaitingDistributionCents > 0) {
    return { label: 'Pendente', tone: 'warning' as const }
  }
  if (summary.releasedCents > 0 && summary.balanceCents <= 0) {
    return { label: 'Pago', tone: 'success' as const }
  }
  if (summary.paidCents > 0) {
    return { label: 'Parcial', tone: 'info' as const }
  }
  if (summary.releasedCents > 0) {
    return { label: 'A pagar', tone: 'warning' as const }
  }
  return { label: 'Previsto', tone: 'ghost' as const }
}

export function PaymentsPage() {
  const { permissions } = useSession()
  const isAdmin = permissions.isAdmin
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(isAdmin ? search.trim() : '')

  const query = useQuery({
    queryKey: [
      'finance',
      'payment-recipients-preview',
      deferredSearch,
      page,
      isAdmin,
    ],
    queryFn: () => fetchPaymentRecipients(deferredSearch, isAdmin ? page : 1),
  })

  const policy = useQuery({
    ...allocationPolicyQuery(),
    enabled: !isAdmin,
  })

  const data = query.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={
          isAdmin
            ? 'Acompanhe os valores previstos, liberados e pagos por recebedor.'
            : 'Acompanhe seus valores previstos, liberados e pagos.'
        }
        eyebrow="Financeiro · Pagamentos"
        title={isAdmin ? 'Pagamentos por recebedor' : 'Minha participação'}
      />

      {!isAdmin ? <AllocationPolicySection policy={policy} /> : null}

      {query.isPending ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatPill
              cents={data.totals.plannedCents}
              label={isAdmin ? 'Previsto' : 'Meu previsto'}
              hint="Valor calculado pelas regras"
            />
            <StatPill
              cents={data.totals.releasedCents}
              label={isAdmin ? 'Liberado' : 'Já liberado'}
              hint="Disponível para pagamento"
            />
            <StatPill
              cents={data.totals.paidCents}
              label={isAdmin ? 'Pago' : 'Já recebi'}
              hint="Pagamentos registrados"
            />
            <StatPill
              cents={data.totals.awaitingDistributionCents}
              label="Pendente"
              hint="Ainda depende da distribuição"
            />
          </div>

          {data.preview.inconsistent ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              Há {data.preview.inconsistentReceipts} recebimento(s) que precisam
              de revisão na distribuição.
            </div>
          ) : null}

          {isAdmin ? (
            <SearchInput
              aria-label="Buscar recebedor ou processo"
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Buscar por recebedor, função, processo, cliente ou condomínio"
              value={search}
            />
          ) : null}

          {data.pagination.total === 0 ? (
            <EmptyState
              description={
                isAdmin
                  ? deferredSearch
                    ? 'Nenhum recebedor corresponde à busca.'
                    : data.preview.pendingReceipts > 0
                      ? 'Ainda não há valor destinado a um recebedor.'
                      : 'Nenhum valor disponível ainda.'
                  : 'Nenhum valor disponível para sua conta.'
              }
              icon={isAdmin ? UserRound : ShieldCheck}
              title={
                isAdmin && deferredSearch
                  ? 'Nenhum resultado'
                  : 'Nenhum valor disponível'
              }
            />
          ) : null}

          {data.items.length > 0 ? (
            <div className="grid gap-3">
              {data.items.map((summary) => (
                <RecipientCard
                  key={summary.recipientId}
                  showDistributionLink={isAdmin}
                  summary={summary}
                />
              ))}
            </div>
          ) : null}

          {isAdmin && data.pagination.totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {data.pagination.total} recebedor(es) · página{' '}
                {data.pagination.page} de {data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={data.pagination.page <= 1 || query.isFetching}
                  onClick={() =>
                    setPage((current) => Math.max(1, current - 1))
                  }
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

function AllocationPolicySection({
  policy,
}: {
  policy: UseQueryResult<AllocationPolicy, Error>
}) {
  if (policy.isPending) {
    return (
      <FinanceSection title="Como o dinheiro é distribuído">
        <LoadingState rows={3} />
      </FinanceSection>
    )
  }

  if (policy.isError) {
    return (
      <FinanceSection title="Como o dinheiro é distribuído">
        <ErrorState error={policy.error} onRetry={() => policy.refetch()} />
      </FinanceSection>
    )
  }

  return (
    <FinanceSection title="Como o dinheiro é distribuído">
      {policy.data.items.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo / função</TableHead>
                <TableHead>Regra</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Escopo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policy.data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.group}</TableCell>
                  <TableCell className="tabular-nums">
                    {item.valueType === 'PERCENTUAL'
                      ? formatBasisPoints(item.basisPoints)
                      : formatCents(item.fixedCents)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatCivilDate(item.validFrom)} –{' '}
                    {item.validTo ? formatCivilDate(item.validTo) : 'aberta'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={item.global ? 'success' : 'info'}>
                      {item.global ? 'Todos os processos' : 'Grupo específico'}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Distribuição ainda não configurada.
        </p>
      )}
    </FinanceSection>
  )
}

function RecipientCard({
  summary,
  showDistributionLink,
}: {
  summary: RecipientSummary
  showDistributionLink: boolean
}) {
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
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            <span className="text-muted-foreground">Previsto </span>
            <Money cents={summary.plannedCents} strong />
          </span>
          <span>
            <span className="text-muted-foreground">Liberado </span>
            <Money cents={summary.releasedCents} />
          </span>
          <span>
            <span className="text-muted-foreground">Pago </span>
            <Money cents={summary.paidCents} />
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
            {open ? 'Ocultar detalhes' : 'Ver detalhes'}
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
          {credits.data && credits.data.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              Nenhum valor liberado.
            </div>
          ) : null}
          {credits.data && credits.data.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Processo / cliente</TableHead>
                    <TableHead>Origem do valor</TableHead>
                    <TableHead className="text-right">Liberado</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">A pagar</TableHead>
                    {showDistributionLink ? (
                      <TableHead className="w-36">Ação</TableHead>
                    ) : null}
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
                            <div className="font-medium">
                              {credit.processCode}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {credit.clientName}
                              {credit.housingComplexName
                                ? ` · ${credit.housingComplexName}`
                                : ''}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {credit.workType || 'Distribuição financeira'}
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
                          {showDistributionLink ? (
                            <TableCell>
                              <Button asChild size="sm" variant="ghost">
                                <Link
                                  params={{ closingId: credit.closingId }}
                                  preload={false}
                                  to="/pagamentos/fechamentos/$closingId"
                                >
                                  <ExternalLink className="size-4" />
                                  Abrir distribuição
                                </Link>
                              </Button>
                            </TableCell>
                          ) : null}
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
