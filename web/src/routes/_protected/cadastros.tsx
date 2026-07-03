import { createFileRoute, redirect } from '@tanstack/react-router'
import { canAccessCadastros } from '@/features/admin/lib/cadastros-access'
import { RegistersPage } from '@/features/admin/pages/registers-page'
import { parseAdminUsersSearch } from '@/features/admin/schemas/admin-users-search.schema'

export const Route = createFileRoute('/_protected/cadastros')({
  validateSearch: (search: Record<string, unknown>) =>
    parseAdminUsersSearch(search),
  // Acesso por permissao de perfil (grupo cadastros) — qualquer aba liberada.
  beforeLoad: ({ context }) => {
    if (!canAccessCadastros(context.permissions)) {
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
