import { createFileRoute } from '@tanstack/react-router'
import { FinanceOverviewPage } from '@/features/finance/pages/finance-overview-page'

export const Route = createFileRoute('/_protected/pagamentos/')({
  component: FinanceOverviewPage,
})
