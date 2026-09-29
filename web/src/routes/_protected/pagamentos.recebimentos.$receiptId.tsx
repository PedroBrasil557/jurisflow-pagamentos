import { createFileRoute } from '@tanstack/react-router'
import { ReceiptDetailPage } from '@/features/finance/pages/receipt-detail-page'

export const Route = createFileRoute(
  '/_protected/pagamentos/recebimentos/$receiptId',
)({
  component: ReceiptDetailRoute,
})

function ReceiptDetailRoute() {
  const { receiptId } = Route.useParams()
  return <ReceiptDetailPage receiptId={receiptId} />
}
