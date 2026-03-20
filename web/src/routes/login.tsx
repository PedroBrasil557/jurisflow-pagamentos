import { createFileRoute, redirect } from '@tanstack/react-router'
import { LoginPage } from '@/features/auth/pages/login-page'
import { parseAuthSearch } from '@/features/auth/schemas/auth.schema'
import { getSession } from '@/features/auth/services/auth-session'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => parseAuthSearch(search),
  beforeLoad: async () => {
    const session = await getSession()

    if (session) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})
