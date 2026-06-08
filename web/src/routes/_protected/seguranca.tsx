import { createFileRoute, redirect } from '@tanstack/react-router'
import { SecurityPage } from '@/features/security/pages/security-page'
import { parseSecuritySearch } from '@/features/security/schemas/security-search.schema'

export const Route = createFileRoute('/_protected/seguranca')({
  validateSearch: (search: Record<string, unknown>) =>
    parseSecuritySearch(search),
  beforeLoad: ({ context }) => {
    if (!context.permissions.isAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: SecurityRoute,
})

function SecurityRoute() {
  const search = Route.useSearch()

  return (
    <SecurityPage
      currentPage={search.page ?? 1}
      currentSearch={search.search ?? ''}
      currentStatus={search.status}
      currentTab={search.tab ?? 'sessions'}
    />
  )
}
