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
  coverage: {
    receivedCents: number
    coveredCents: number
    uncoveredCents: number
    coverageBasisPoints: number
    complete: boolean
    inconsistent: boolean
    inconsistentReceipts: number
    pendingReceipts: number
    finalizedCents: number
    projectedCents: number
    provisionCents: number
    reserveCents: number
    recipientCents: number
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

  const receivedCents = data?.coverage.receivedCents ?? 0
  const coveredCents = data?.coverage.coveredCents ?? 0
  const pendingCents = data?.coverage.uncoveredCents ?? 0
  const coverage = (data?.coverage.coverageBasisPoints ?? 0) / 100
  const hasEntries = receivedCents > 0
  const distributionComplete = data?.coverage.complete ?? false
  const inconsistent = data?.coverage.inconsistent ?? false

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Acompanhe quanto entrou, quanto já está coberto pelas regras e quanto ainda precisa de destino. A prévia aparece mesmo antes da distribuição chegar a 100%."
        eyebrow="Financeiro"
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
              description="Defina quem recebe e os percentuais. O Financeiro mostra a cobertura parcial e só considera a distribuição finalizada quando alcançar 100%."
              icon={Settings2}
              title="Configure as regras do Financeiro"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill
              cents={receivedCents}
              label="Recebido"
              hint="Total de entradas com valor liberado"
            />
            <StatPill
              cents={coveredCents}
              label="Coberto pelas regras"
              hint="Valor que já possui destino pela configuração atual"
            />
            <StatPill
              cents={pendingCents}
              label="Falta cobrir"
              hint="Valor que ainda precisa de regra ou destino"
            />
          </div>

          <FinanceSection title="Cobertura da distribuição">
            <div className="grid gap-4 xl:grid-cols-[1fr_280px] xl:items-stretch">
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_auto] gap-4 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Destino previsto</span>
                  <span>Valor</span>
                </div>
                <MoneyRow
                  label="Provisões previstas"
                  cents={data.coverage.provisionCents}
                />
                <MoneyRow
                  label="Reservas previstas"
                  cents={data.coverage.reserveCents}
                />
                <MoneyRow
                  label="Recebedores previstos"
                  cents={data.coverage.recipientCents}
                />
                <MoneyRow label="Ainda sem regra" cents={pendingCents} />
                <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-border px-4 py-3 text-sm font-semibold">
                  <span>Total recebido</span>
                  <Money cents={receivedCents} strong />
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border p-4 text-center">
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                    inconsistent
                      ? 'border-destructive/50 bg-destructive/5 text-destructive'
                      : distributionComplete
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
                  {inconsistent
                    ? 'Regras precisam de revisão'
                    : distributionComplete
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
                      Falta cobrir <Money cents={pendingCents} strong />
                    </>
                  ) : (
                    'Registre uma entrada para iniciar a distribuição.'
                  )}
                </div>

                {data.coverage.projectedCents > 0 && !distributionComplete ? (
                  <p className="max-w-60 text-xs text-muted-foreground">
                    Já existem <Money cents={data.coverage.projectedCents} strong />{' '}
                    previstos pelas regras atuais, mas ainda não finalizados.
                  </p>
                ) : null}

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

          <p className="text-xs text-muted-foreground">
            Prévia calculada com as regras atualmente configuradas. Valores de
            pagamento só são gerados quando a distribuição estiver completa e for
            finalizada.
          </p>
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
