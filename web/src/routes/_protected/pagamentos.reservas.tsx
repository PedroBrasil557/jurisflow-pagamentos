import { createFileRoute } from '@tanstack/react-router'
import { ReservesPage } from '@/features/finance/pages/reserves-page'

export const Route = createFileRoute('/_protected/pagamentos/reservas')({
  component: ReservesPage,
})
