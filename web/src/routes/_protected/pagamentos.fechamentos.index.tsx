import { createFileRoute } from '@tanstack/react-router'
import { ClosingsPage } from '@/features/finance/pages/closings-page'

export const Route = createFileRoute('/_protected/pagamentos/fechamentos/')({
  component: ClosingsPage,
})
