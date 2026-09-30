import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Settings2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import {
  EmptyState,
  ErrorState,
  FinanceSection,
  LoadingState,
  Money,
} from '../components/finance-ui'
import { financeAccess } from '../lib/finance-labels'
import {
  closingsQuery,
  overviewQuery,
  reservesQuery,
} from '../services/finance.queries'

export function FinanceOverviewPage() {
  const { permissions } = useSession()
  const overview = useQuery(overviewQuery())
  const closings = useQuery(closingsQuery())
  const reserves = useQuery(reservesQuery())
  const data = overview.data
  const noConfig = data && data.config.activeRules === 0

  const activeClosings = (closings.data ?? []).filter(
    (closing) => closing.status === 'ATIVO',
  )
  const closedGrossCents = activeClosings.reduce(
    (sum, closing) => sum + closing.grossCents,
    0,
  )
  const provisionCents = (reserves.data ?? [])
    .filter((pool) => pool.nature === 'PROVISAO')
    .reduce((sum, pool) => sum + pool.constitutedCents, 0)
  const reserveCents = (reserves.data ?? [])
    .filter((pool) => pool.nature === 'RESERVA')
    .reduce((sum, pool) => sum + pool.constitutedCents, 0)
  const separatedCents = provisionCents + reserveCents
  const recipientCents = data?.credits.dueCents ?? 0
  const allocatedCents = separatedCents + recipientCents
  const differenceCents = closedGrossCents - allocatedCents
  const balanced = differenceCents === 0

  const pending = overview.isPending || closings.isPending || reserves.isPending
  const firstError = overview.error ?? closings.error ?? reserves.error

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Acompanhe o caminho do dinheiro: quanto entrou, para onde foi destinado e o que ainda falta fazer."
        eyebrow="Pagamentos"
        title="Visão geral"
      >
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
      </PageHeader>

      {pending ? <LoadingState /> : null}
      {firstError ? (
        <ErrorState
          error={firstError}
          onRetry={() => {
            overview.refetch()
            closings.refetch()
            reserves.refetch()
          }}
        />
      ) : null}

      {data && !pending ? (
        <>
          {noConfig ? (
            <EmptyState
              action={
                financeAccess.regras(permissions) ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild>
                      <Link
                        className="no-underline"
                        preload={false}
                        to="/pagamentos/configuracao/novo"
                      >
                        <Settings2 className="size-4" />
                        Configurar regras
                      </Link>
                    </Button>
                    {financeAccess.importar(permissions) ? (
                      <Button asChild variant="outline">
                        <Link
                          className="no-underline"
                          preload={false}
                          to="/pagamentos/configuracao/importar"
                        >
                          <FileSpreadsheet className="size-4" />
                          Importar planilha
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null
              }
              description="Ainda não existe regra financeira. Sem configuração o sistema não inventa percentuais nem destinos."
              icon={Settings2}
              title="Configure o financeiro antes de calcular"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              cents={closedGrossCents}
              hint="dinheiro recebido"
              label="Entrou"
            />
            <SummaryCard
              cents={separatedCents}
              hint="provisões + reservas"
              label="Separado"
            />
            <SummaryCard
              cents={recipientCents}
              hint="valor destinado a pessoas e empresas"
              label="Devido aos recebedores"
            />
            <SummaryCard
              cents={data.credits.balanceCents}
              hint="pendência atual"
              label="Ainda falta pagar"
            />
          </div>

          <FinanceSection title="Para onde foi o dinheiro?">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Destino</span>
                  <span>Valor</span>
                </div>
                <DestinationRow label="Provisões" cents={provisionCents} />
                <DestinationRow label="Reservas" cents={reserveCents} />
                <DestinationRow label="Recebedores" cents={recipientCents} />
                <DestinationRow
                  cents={allocatedCents}
                  label="Total destinado"
                  strong
                />
              </div>

              <div className="flex flex-col items-center justify-center gap-3 border-t border-border pt-5 text-center lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold ${
                    balanced
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500'
                      : 'border-destructive/50 bg-destructive/10 text-destructive'
                  }`}
                >
                  {balanced ? (
                    <CheckCircle2 className="size-5" />
                  ) : (
                    <TriangleAlert className="size-5" />
                  )}
                  {balanced ? 'Tudo conciliado' : 'Diferença encontrada'}
                </div>
                <div className="text-sm text-muted-foreground">
                  Diferença{' '}
                  <Money
                    cents={differenceCents}
                    className="ml-1 text-foreground"
                    strong
                  />
                </div>
              </div>
            </div>
          </FinanceSection>
        </>
      ) : null}
    </div>
  )
}

function SummaryCard({
  label,
  cents,
  hint,
}: {
  label: string
  cents: number
  hint: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        <Money cents={cents} strong />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

function DestinationRow({
  label,
  cents,
  strong = false,
}: {
  label: string
  cents: number
  strong?: boolean
}) {
  return (
    <div
      className={`grid grid-cols-[1fr_auto] gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0 ${
        strong ? 'bg-muted/20 font-semibold' : ''
      }`}
    >
      <span>{label}</span>
      <Money cents={cents} strong={strong} />
    </div>
  )
}
