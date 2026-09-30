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
            <StatPill
              cents={closedGrossCents}
              label="Entrou"
              hint="Dinheiro dos rateios já finalizados"
            />
            <StatPill
              cents={separatedCents}
              label="Separado"
              hint="Provisões + reservas"
            />
            <StatPill
              cents={recipientCents}
              label="Devido aos recebedores"
              hint="Valor destinado a pessoas e empresas"
            />
            <StatPill
              cents={data.credits.balanceCents}
              label="Ainda falta pagar"
              hint="Pendência atual dos recebedores"
            />
          </div>

          <FinanceSection title="Para onde foi o dinheiro?">
            <div className="grid gap-4 xl:grid-cols-[1fr_240px] xl:items-stretch">
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_auto] gap-4 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Destino</span>
                  <span>Valor</span>
                </div>
                <MoneyRow label="Provisões" cents={provisionCents} />
                <MoneyRow label="Reservas" cents={reserveCents} />
                <MoneyRow label="Recebedores" cents={recipientCents} />
                <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-border px-4 py-3 text-sm font-semibold">
                  <span>Total destinado</span>
                  <Money cents={allocatedCents} strong />
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border p-4 text-center">
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${balanced ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600' : 'border-destructive/50 bg-destructive/5 text-destructive'}`}
                >
                  {balanced ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <TriangleAlert className="size-4" />
                  )}
                  {balanced ? 'Tudo conciliado' : 'Há valor sem destino'}
                </div>
                <div className="text-xs text-muted-foreground">
                  Diferença <Money cents={differenceCents} strong />
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
