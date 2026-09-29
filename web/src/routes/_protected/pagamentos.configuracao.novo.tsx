import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useSession } from '@/features/auth/hooks/use-session'
import {
  BackLink,
  DeniedState,
  FinanceSection,
} from '@/features/finance/components/finance-ui'
import { RuleForm } from '@/features/finance/components/rule-form'
import { financeAccess } from '@/features/finance/lib/finance-labels'
import { useCreateRule } from '@/features/finance/services/finance.mutations'
import { PageHeader } from '@/shared/components/page-header'

export const Route = createFileRoute(
  '/_protected/pagamentos/configuracao/novo',
)({
  component: NewRulePage,
})

/** P04B: cadastro manual de regra. */
function NewRulePage() {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const mutation = useCreateRule()
  if (!financeAccess.regras(permissions)) return <DeniedState />
  return (
    <div className="flex flex-col gap-6">
      <BackLink label="Configuração" to="/pagamentos/configuracao" />
      <PageHeader
        description="Cada regra diz quem recebe, em qual etapa, sobre qual base, com qual percentual ou valor, em que vigência e para quais condomínios."
        eyebrow="Pagamentos · configuração"
        title="Nova regra"
      />
      <FinanceSection title="Parâmetros">
        <RuleForm
          onSubmit={(payload) =>
            mutation.mutate(payload, {
              onSuccess: () => {
                toast.success('Regra salva (versão 1).')
                navigate({ to: '/pagamentos/configuracao' })
              },
            })
          }
          pending={mutation.isPending}
          submitLabel="Salvar regra"
        />
      </FinanceSection>
    </div>
  )
}
