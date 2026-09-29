import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useSession } from '@/features/auth/hooks/use-session'
import {
  BackLink,
  DeniedState,
  FinanceSection,
} from '@/features/finance/components/finance-ui'
import { SimpleRuleForm } from '@/features/finance/components/rule-form-simple'
import { financeAccess } from '@/features/finance/lib/finance-labels'
import { useCreateRule } from '@/features/finance/services/finance.mutations'
import { PageHeader } from '@/shared/components/page-header'

export const Route = createFileRoute(
  '/_protected/pagamentos/configuracao/novo',
)({
  component: NewRulePage,
})

/** Cadastro manual orientado pela finalidade financeira da regra. */
function NewRulePage() {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const mutation = useCreateRule()
  if (!financeAccess.regras(permissions)) return <DeniedState />
  return (
    <div className="flex flex-col gap-6">
      <BackLink label="Configuração" to="/pagamentos/configuracao" />
      <PageHeader
        description="Comece pelo significado financeiro da regra: quem recebe, o que será separado, quanto e onde ela vale. Os códigos internos do motor ficam na memória técnica."
        eyebrow="Pagamentos · configuração"
        title="Nova regra"
      />
      <FinanceSection
        description="O sistema transforma estas respostas na regra técnica usada pelo motor financeiro."
        title="Configuração guiada"
      >
        <SimpleRuleForm
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
