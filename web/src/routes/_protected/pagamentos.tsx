import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useSession } from '@/features/auth/hooks/use-session'
import { DeniedState } from '@/features/finance/components/finance-ui'
import { financeAccess } from '@/features/finance/lib/finance-labels'

export const Route = createFileRoute('/_protected/pagamentos')({
  component: PaymentsLayout,
})

const sections = [
  { to: '/pagamentos', label: 'Visão geral', exact: true },
  { to: '/pagamentos/recebimentos', label: 'Entradas' },
  { to: '/pagamentos/fechamentos', label: 'Rateios' },
  { to: '/pagamentos/pagamentos', label: 'Pagamentos' },
  { to: '/pagamentos/reservas', label: 'Reservas' },
  { to: '/pagamentos/extratos', label: 'Extrato' },
  { to: '/pagamentos/configuracao', label: 'Configuração' },
] as const

function PaymentsLayout() {
  const { permissions } = useSession()
  if (!financeAccess.view(permissions)) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <DeniedState />
      </div>
    )
  }
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <nav
        aria-label="Seções de Pagamentos"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px"
      >
        {sections.map((section) => (
          <Link
            activeOptions={{ exact: 'exact' in section }}
            activeProps={{
              className: 'border-primary text-foreground',
              'aria-current': 'page',
            }}
            className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            key={section.to}
            preload={false}
            to={section.to}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
