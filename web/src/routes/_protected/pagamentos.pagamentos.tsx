import { createFileRoute } from '@tanstack/react-router'
import { PaymentsPage } from '@/features/finance/pages/payments-page'

export const Route = createFileRoute('/_protected/pagamentos/pagamentos')({
  component: PaymentsPage,
})
