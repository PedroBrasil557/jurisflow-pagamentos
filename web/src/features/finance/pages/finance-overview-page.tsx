import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, List, Plus, Settings2, TriangleAlert } from 'lucide-react'
import { Button } from '#/components/ui/button'
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
import { financeAccess } from '../lib/finance-labels'
import { overviewQuery } from '../services/finance.queries'

type HardenedOverview = {
  receipts: {
    receivedCents: number
    ratedCents: number
    pendingRateioCents: number
  }
  credits: {
    dueCents: number
    paidCents: number
    balanceCents: number
  }
  allocations: {
    provisionCents: number
    reserveCents: number
    recipientCents: number
    allocatedCents: number
    differenceCents: number
    balanced: boolean
  }
  config: {
    recipients: number
    activeRules: number
  }
}

export function FinanceOverviewPage() {
  const { permissions } = useSession()
  const overview = useQuery(overviewQuery())
  const data = overview.data as HardenedOverview | undefined
  const noConfig =
    data &&
    data.config.activeRules === 0 &&
    financeAccess.regras(permissions)

  const receivedCents = data?.receipts.receivedCents ?? 0
  const distributedCents = data?.receipts.ratedCents ?? 0
  const pendingCents = data?.receipts.pendingRateioCents ?? 0
  const coverage =
    receivedCents > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((distributedCents / receivedCents) * 10_000) / 100),
        )
      : 0
  const hasEntries = receivedCents > 0
  const distributionComplete = hasEntries && pendingCents === 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Registre o valor recebido e acompanhe se 100% dele já foi distribuído pelas regras. Se ainda existir valor sem distribuição, ele permanece pendente."
        eyebrow="Pagamentos"
        title="Distribuição"
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link
              className="no-underline"
              preload={false}
              to="/pagamentos/recebimentos"
            >
              <List className="size-4" />
              Ver entradas
            </Link>
          </Button>
          {financeAccess.lancar(permissions) ? (
            <Button asChild>
              <Link
                className="no-underline"
                preload={false}
                to="/pagamentos/recebimentos/novo"
              >
                <Plus className="size-4" />
                Registrar entrada
              </Link>
            </Button>
          ) : null}
        </div>
      </PageHeader>

      {overview.isPending ? <LoadingState /> : null}
      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : null}

      {data && !overview.isPending ? (
        <>
          {noConfig ? (
            <EmptyState
              action={
                <Button asChild>
                  <Link
                    className="no-underline"
                    preload={false}
                    to="/pagamentos/configuracao"
                  >
                    <Settings2 className="size-4" />
                    Configurar distribuição
                  </Link>
                </Button>
              }
              description="Defina quem recebe e os percentuais. O sistema só considera a distribuição pronta quando ela alcançar 100%."
              icon={Settings2}
              title="Configure a distribuição antes de começar"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill
              cents={receivedCents}
              label="Recebido"
              hint="Total de entradas com valor liberado"
            />
            <StatPill
              cents={distributedCents}
              label="Distribuído"
              hint="Valor que já teve sua distribuição finalizada"
            />
            <StatPill
              cents={pendingCents}
              label="Pendente"
              hint="Valor recebido que ainda precisa completar a distribuição"
            />
          </div>

          <FinanceSection title="Cobertura da distribuição">
            <div className="grid gap-4 xl:grid-cols-[1fr_280px] xl:items-stretch">
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_auto] gap-4 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Destino</span>
                  <span>Valor</span>
                </div>
                <MoneyRow
                  label="Provisões"
                  cents={data.allocations.provisionCents}
                />
                <MoneyRow
                  label="Reservas"
                  cents={data.allocations.reserveCents}
                />
                <MoneyRow
                  label="Recebedores"
                  cents={data.allocations.recipientCents}
                />
                <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-border px-4 py-3 text-sm font-semibold">
                  <span>Total destinado</span>
                  <Money cents={data.allocations.allocatedCents} strong />
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border p-4 text-center">
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                    distributionComplete
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600'
                      : hasEntries
                        ? 'border-amber-500/35 bg-amber-500/10 text-amber-600'
                        : 'border-border bg-muted/30 text-muted-foreground'
                  }`}
                >
                  {distributionComplete ? (
                    <CheckCircle2 className="size-4" />
                  ) : hasEntries ? (
                    <TriangleAlert className="size-4" />
                  ) : null}
                  {distributionComplete
                    ? 'Distribuição finalizada'
                    : hasEntries
                      ? 'Distribuição pendente'
                      : 'Aguardando entradas'}
                </div>

                <div className="text-3xl font-semibold tabular-nums">
                  {coverage.toLocaleString('pt-BR', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                  %
                </div>
                <div className="text-xs text-muted-foreground">
                  {hasEntries ? (
                    <>
                      Falta distribuir <Money cents={pendingCents} strong />
                    </>
                  ) : (
                    'Registre uma entrada para iniciar a distribuição.'
                  )}
                </div>

                {hasEntries && pendingCents > 0 && financeAccess.conferir(permissions) ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      className="no-underline"
                      preload={false}
                      to="/pagamentos/fechamentos"
                    >
                      Revisar distribuição
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </FinanceSection>
        </>
      ) : null}
    </div>
  )
}

function MoneyRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-border px-4 py-3 text-sm first:border-t-0">
      <span>{label}</span>
      <Money cents={cents} />
    </div>
  )
}
