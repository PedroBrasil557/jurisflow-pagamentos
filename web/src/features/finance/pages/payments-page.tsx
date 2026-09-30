import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, ExternalLink, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  StatPill,
} from '../components/finance-ui'
import { creditsQuery } from '../services/finance.queries'
import type { Credit } from '../services/finance.service'

type RecipientSummary = {
  recipientId: string
  recipientName: string
  workTypes: string[]
  dueCents: number
  paidCents: number
  balanceCents: number
  credits: Credit[]
}

function summarizeCredits(credits: Credit[]): RecipientSummary[] {
  const byRecipient = new Map<string, RecipientSummary>()

  for (const credit of credits) {
    if (credit.status === 'ESTORNADO') continue
    const due = credit.amountCents + credit.adjustedCents
    const current = byRecipient.get(credit.recipientId) ?? {
      recipientId: credit.recipientId,
      recipientName: credit.recipientName,
      workTypes: [],
      dueCents: 0,
      paidCents: 0,
      balanceCents: 0,
      credits: [],
    }

    current.dueCents += due
    current.paidCents += credit.paidCents
    current.balanceCents += due - credit.paidCents
    current.credits.push(credit)
    if (credit.workType?.trim() && !current.workTypes.includes(credit.workType)) {
      current.workTypes.push(credit.workType)
    }
    byRecipient.set(credit.recipientId, current)
  }

  return [...byRecipient.values()].sort((a, b) =>
    a.recipientName.localeCompare(b.recipientName, 'pt-BR'),
  )
}

function summaryTone(summary: RecipientSummary) {
  if (summary.balanceCents <= 0) return { label: 'Pago', tone: 'success' as const }
  if (summary.paidCents > 0)
    return { label: 'Parcial', tone: 'info' as const }
  return { label: 'A pagar', tone: 'warning' as const }
}

export function PaymentsPage() {
  const query = useQuery(creditsQuery({}))
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const summaries = useMemo(
    () => summarizeCredits(query.data ?? []),
    [query.data],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return summaries
    return summaries.filter((summary) => {
      const haystack = [
        summary.recipientName,
        ...summary.workTypes,
        ...summary.credits.flatMap((credit) => [
          credit.processCode,
          credit.clientName,
          credit.housingComplexName ?? '',
        ]),
      ]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
      return haystack.includes(term)
    })
  }, [search, summaries])

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, summary) => ({
          dueCents: acc.dueCents + summary.dueCents,
          paidCents: acc.paidCents + summary.paidCents,
          balanceCents: acc.balanceCents + summary.balanceCents,
        }),
        { dueCents: 0, paidCents: 0, balanceCents: 0 },
      ),
    [summaries],
  )

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

      {query.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill
              cents={totals.dueCents}
              label="Total devido"
              hint="Direito gerado pelos rateios finalizados"
            />
            <StatPill
              cents={totals.paidCents}
              label="Total pago"
              hint="Pagamentos já registrados"
            />
            <StatPill
              cents={totals.balanceCents}
              label="Ainda falta pagar"
              hint="Saldo aberto de todos os recebedores"
            />
          </div>

          <SearchInput
            aria-label="Buscar recebedor ou processo"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por recebedor, função, processo, cliente ou condomínio"
            value={search}
          />

          {summaries.length === 0 ? (
            <EmptyState
              description="Os valores a pagar aparecem aqui depois que um rateio é finalizado."
              icon={UserRound}
              title="Nenhum valor a pagar ainda"
            />
          ) : null}

          {summaries.length > 0 && filtered.length === 0 ? (
            <EmptyState
              description="Nenhum recebedor corresponde à busca."
              icon={UserRound}
              title="Nenhum resultado"
            />
          ) : null}

          {filtered.length > 0 ? (
            <div className="grid gap-3">
              {filtered.map((summary) => {
                const open = expanded === summary.recipientId
                const status = summaryTone(summary)
                return (
                  <section
                    className="overflow-hidden rounded-lg border border-border bg-card"
                    key={summary.recipientId}
                  >
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
                          {summary.credits.length} valor(es) originado(s) em rateios
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
                          onClick={() =>
                            setExpanded(open ? null : summary.recipientId)
                          }
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
                              {summary.credits.map((credit) => {
                                const due =
                                  credit.amountCents + credit.adjustedCents
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
                      </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
