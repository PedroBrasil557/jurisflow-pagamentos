import { createFileRoute, redirect } from '@tanstack/react-router'
import { RegistersPage } from '@/features/admin/pages/registers-page'
import { parseAdminUsersSearch } from '@/features/admin/schemas/admin-users-search.schema'

export const Route = createFileRoute('/_protected/cadastros')({
  validateSearch: (search: Record<string, unknown>) =>
    parseAdminUsersSearch(search),
  beforeLoad: ({ context }) => {
    if (!context.permissions.isAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: RegistersRoute,
})

function RegistersRoute() {
  const search = Route.useSearch()

  return (
    <RegistersPage
      currentPage={search.page ?? 1}
      currentSearch={search.search ?? ''}
    />
  )
}
