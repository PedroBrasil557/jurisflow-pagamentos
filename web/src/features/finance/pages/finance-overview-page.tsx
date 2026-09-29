import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
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
  const recipientCents = data?.credits.dueCents ?? 0
  const allocatedCents = provisionCents + reserveCents + recipientCents
  const differenceCents = closedGrossCents - allocatedCents
  const balanced = differenceCents === 0

  const pending = overview.isPending || closings.isPending || reserves.isPending
  const firstError = overview.error ?? closings.error ?? reserves.error

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Acompanhe o caminho do dinheiro: quanto entrou, para onde foi destinado, quanto já foi pago e o que ainda está pendente."
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

          <FinanceSection
            description="Esta é a conciliação dos rateios já finalizados. Tudo que entrou precisa ter um destino visível."
            title="Para onde foi o dinheiro"
          >
            <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-center">
              <FlowCard label="Entrou nos rateios finalizados" cents={closedGrossCents} />
              <ArrowRight className="mx-auto hidden size-4 text-muted-foreground xl:block" />
              <FlowCard label="Provisões" cents={provisionCents} />
              <span className="mx-auto hidden text-muted-foreground xl:block">+</span>
              <FlowCard label="Reservas" cents={reserveCents} />
              <span className="mx-auto hidden text-muted-foreground xl:block">+</span>
              <FlowCard label="Pessoas e empresas" cents={recipientCents} />
            </div>

            <div className={`mt-3 flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${balanced ? 'border-emerald-500/35 bg-emerald-500/5' : 'border-destructive/50 bg-destructive/5'}`}>
              <div>
                <div className="text-sm font-medium">Conferência do dinheiro finalizado</div>
                <div className="text-xs text-muted-foreground">
                  Total destinado <Money cents={allocatedCents} /> de <Money cents={closedGrossCents} />.
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {balanced ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <TriangleAlert className="size-4 text-destructive" />
                )}
                Diferença <Money cents={differenceCents} />
              </div>
            </div>
          </FinanceSection>

          <FinanceSection
            description="Depois que o rateio é finalizado, os valores destinados a pessoas e empresas viram obrigações de pagamento."
            title="Pagamentos aos recebedores"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <StatPill
                cents={data.credits.dueCents}
                label="Total devido"
                hint="Quanto os recebedores têm direito"
              />
              <StatPill
                cents={data.credits.paidCents}
                label="Já pago"
                hint="Pagamentos registrados no JurisFlow"
              />
              <StatPill
                cents={data.credits.balanceCents}
                label="Ainda falta pagar"
                hint="Saldo aberto dos recebedores"
              />
            </div>
          </FinanceSection>

          <div className="grid gap-4 lg:grid-cols-2">
            <FinanceSection
              description="Entradas passam por conferência, aprovação e finalização do rateio."
              title="Entradas por situação"
            >
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Rascunho/conferência', data.receipts.draft],
                  ['Bloqueadas', data.receipts.blocked],
                  ['Prontas para finalizar', data.receipts.ready],
                  ['Rateio finalizado', data.receipts.closed],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Entradas registradas, inclusive ainda não finalizadas: <Money cents={data.receipts.grossCents} />.
              </p>
            </FinanceSection>

            <FinanceSection title="Configuração e saldos separados">
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Recebedores</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {data.config.recipients}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Regras ativas</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {data.config.activeRules}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Saldo atual em reservas/provisões</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    <Money cents={data.reservesBalanceCents} />
                  </dd>
                </div>
              </dl>
            </FinanceSection>
          </div>
        </>
      ) : null}
    </div>
  )
}

function FlowCard({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">
        <Money cents={cents} strong />
      </div>
    </div>
  )
}
