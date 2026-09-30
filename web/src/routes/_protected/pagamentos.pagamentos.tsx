import { createFileRoute } from '@tanstack/react-router'
import { PaymentsPage } from '@/features/finance/pages/payments-page'

// O plugin do TanStack Router atualiza routeTree.gen.ts no dev/build. O cast
// mantém o typecheck de um checkout limpo válido antes dessa geração ocorrer.
export const Route = createFileRoute(
  '/_protected/pagamentos/pagamentos' as never,
)({
  component: PaymentsPage,
})
