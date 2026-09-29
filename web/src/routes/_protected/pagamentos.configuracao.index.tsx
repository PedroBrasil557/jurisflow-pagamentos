import { createFileRoute } from '@tanstack/react-router'
import { FinanceConfigPage } from '@/features/finance/pages/finance-config-page'

export const Route = createFileRoute('/_protected/pagamentos/configuracao/')({
  component: FinanceConfigPage,
})
