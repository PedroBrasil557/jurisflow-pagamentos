import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useSession } from '@/features/auth/hooks/use-session'
import { getSession } from '@/features/auth/services/auth-session'
import { AuthenticatedLayout } from '@/shared/components/authenticated-layout/authenticated-layout'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()

    if (!session) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }

    if (
      session.user.mustChangePassword &&
      location.pathname !== '/primeiro-acesso'
    ) {
      throw redirect({
        to: '/primeiro-acesso',
      })
    }

    if (
      !session.user.mustChangePassword &&
      location.pathname === '/primeiro-acesso'
    ) {
      throw redirect({
        to: '/',
      })
    }

    return {
      session: session.session,
      user: session.user,
      permissions: session.permissions,
    }
  },
  shouldReload: false,
  component: ProtectedRoute,
})

function ProtectedRoute() {
  const { user, permissions } = useSession()

  return (
    <AuthenticatedLayout permissions={permissions} user={user}>
      <Outlet />
    </AuthenticatedLayout>
  )
}
