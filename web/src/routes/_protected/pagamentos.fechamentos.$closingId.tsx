import { createFileRoute } from '@tanstack/react-router'
import { ClosingDetailPage } from '@/features/finance/pages/closing-detail-page'

export const Route = createFileRoute(
  '/_protected/pagamentos/fechamentos/$closingId',
)({
  component: ClosingDetailRoute,
})

function ClosingDetailRoute() {
  const { closingId } = Route.useParams()
  return <ClosingDetailPage closingId={closingId} />
}
