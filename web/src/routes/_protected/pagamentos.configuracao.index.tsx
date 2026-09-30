import { createFileRoute } from '@tanstack/react-router'
import { FinanceQuickConfigPage } from '@/features/finance/pages/finance-quick-config-page'

export const Route = createFileRoute('/_protected/pagamentos/configuracao/')({
  component: FinanceQuickConfigPage,
})
