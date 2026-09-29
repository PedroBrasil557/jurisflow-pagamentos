import { createFileRoute } from '@tanstack/react-router'
import { ReceiptsPage } from '@/features/finance/pages/receipts-page'

export const Route = createFileRoute('/_protected/pagamentos/recebimentos/')({
  component: ReceiptsPage,
})
