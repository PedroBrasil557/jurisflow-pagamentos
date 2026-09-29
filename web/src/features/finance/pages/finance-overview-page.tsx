import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileSpreadsheet, Plus, Settings2 } from 'lucide-react'
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

export function FinanceOverviewPage() {
  const { permissions } = useSession()
  const query = useQuery(overviewQuery())
  const data = query.data
  const noConfig = data && data.config.activeRules === 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Entradas, créditos a pagar, baixas registradas e reservas. O sistema calcula com as regras configuradas; ele não transfere dinheiro."
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
              Novo recebimento
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      {query.isPending ? <LoadingState /> : null}
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : null}

      {data ? (
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
                        Cadastrar manualmente
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
              description="Nenhum recebedor, regra, percentual ou vigência cadastrado. Sem configuração, todo cálculo fica bloqueado — nenhum valor é inventado."
              icon={Settings2}
              title="Configuração financeira vazia"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatPill
              cents={data.receipts.grossCents}
              hint={`${data.receipts.count} recebimento(s), exceto cancelados`}
              label="Recebido (bruto)"
            />
            <StatPill
              cents={data.credits.dueCents}
              label="Créditos gerados"
              hint="Valor devido aos recebedores"
            />
            <StatPill
              cents={data.credits.paidCents}
              label="Baixas registradas"
              hint="Pagamentos feitos fora da plataforma"
            />
            <StatPill cents={data.credits.balanceCents} label="Saldo a pagar" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <FinanceSection
              description="Fluxo: rascunho → prévia → apto → fechado."
              title="Recebimentos por situação"
            >
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Rascunho/prévia', data.receipts.draft],
                  ['Bloqueados', data.receipts.blocked],
                  ['Aptos', data.receipts.ready],
                  ['Fechados', data.receipts.closed],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </FinanceSection>
            <FinanceSection title="Configuração e reservas">
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
                  <dt className="text-muted-foreground">Saldo em reservas</dt>
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
