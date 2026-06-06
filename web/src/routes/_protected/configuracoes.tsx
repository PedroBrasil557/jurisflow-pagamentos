import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsPage } from '@/features/settings/pages/settings-page'

export const Route = createFileRoute('/_protected/configuracoes')({
  beforeLoad: ({ context }) => {
    if (!context.permissions.isAdmin) {
      throw redirect({ to: '/' })
    }
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  return <SettingsPage />
}
