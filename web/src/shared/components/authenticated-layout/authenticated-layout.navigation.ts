import { ClipboardCheck, LayoutDashboard, UserPlus } from 'lucide-react'
import { isAdminRole } from '@/features/auth/auth.roles'
import type { AuthenticatedNavigationItem } from './authenticated-layout.types'

export const authenticatedNavigationItems = [
  {
    label: 'Dashboard',
    description: 'Visao geral',
    to: '/',
    icon: LayoutDashboard,
  },
  {
    label: 'Processos',
    description: 'Fluxo principal',
    to: '/processos',
    icon: ClipboardCheck,
  },
  {
    label: 'Cadastros',
    description: 'Area administrativa',
    to: '/cadastros',
    icon: UserPlus,
    isVisible: (role: string) => isAdminRole(role),
  },
] satisfies readonly AuthenticatedNavigationItem[]
