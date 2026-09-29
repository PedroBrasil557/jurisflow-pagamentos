import { createFileRoute } from '@tanstack/react-router'
import { StatementPage } from '@/features/finance/pages/statement-page'

export const Route = createFileRoute('/_protected/pagamentos/extratos')({
  component: StatementPage,
})
