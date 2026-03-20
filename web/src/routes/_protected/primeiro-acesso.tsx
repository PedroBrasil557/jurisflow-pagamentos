import { createFileRoute } from '@tanstack/react-router'
import { FirstAccessPage } from '@/features/auth/pages/first-access-page'

export const Route = createFileRoute('/_protected/primeiro-acesso')({
  component: FirstAccessRoute,
})

function FirstAccessRoute() {
  const { user } = Route.useRouteContext()

  return (
    <FirstAccessPage
      user={{
        email: user.email,
        name: user.name,
      }}
    />
  )
}
