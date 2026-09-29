import { createFileRoute } from '@tanstack/react-router'
import { ReceiptNewPage } from '@/features/finance/pages/receipt-new-page'

export const Route = createFileRoute(
  '/_protected/pagamentos/recebimentos/novo',
)({
  component: ReceiptNewPage,
})
