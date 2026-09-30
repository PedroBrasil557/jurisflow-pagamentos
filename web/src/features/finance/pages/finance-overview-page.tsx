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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Acompanhe o caminho do dinheiro: quanto entrou, quanto já foi rateado, para onde foi destinado e o que ainda falta pagar."
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

      {overview.isPending ? <LoadingState /> : null}
      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : null}

      {data && !overview.isPending ? (
        <>
          {noConfig ? (
            <EmptyState
              action={
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
              }
              description="Ainda não existe regra financeira. Sem configuração o sistema não inventa percentuais nem destinos."
              icon={Settings2}
              title="Configure o financeiro antes de calcular"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatPill
              cents={data.receipts.receivedCents}
              label="Entrou"
              hint="Entradas com data de liberação registrada"
            />
            <StatPill
              cents={data.receipts.ratedCents}
              label="Já rateado"
              hint="Entradas incluídas em rateios ativos"
            />
            <StatPill
              cents={data.receipts.pendingRateioCents}
              label="Aguardando rateio"
              hint="Entrou, mas ainda não foi finalizado em rateio"
            />
            <StatPill
              cents={data.credits.dueCents}
              label="Devido aos recebedores"
              hint="Obrigação atual, incluindo ajustes"
            />
            <StatPill
              cents={data.credits.balanceCents}
              label="Ainda falta pagar"
              hint="Pendência atual dos recebedores"
            />
          </div>

          <FinanceSection title="Para onde foi o dinheiro rateado?">
            <div className="grid gap-4 xl:grid-cols-[1fr_240px] xl:items-stretch">
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
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${data.allocations.balanced ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600' : 'border-destructive/50 bg-destructive/5 text-destructive'}`}
                >
                  {data.allocations.balanced ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <TriangleAlert className="size-4" />
                  )}
                  {data.allocations.balanced
                    ? 'Tudo conciliado'
                    : 'Há valor sem destino'}
                </div>
                <div className="text-xs text-muted-foreground">
                  Diferença{' '}
                  <Money cents={data.allocations.differenceCents} strong />
                </div>
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
