import {
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import { canAccessDashboard } from '@/features/processes/lib/process-access'
import { canViewTitularesCaixa } from '@/features/titulares-caixa/lib/titulares-access'
import type { AuthenticatedNavigationItem } from './authenticated-layout.types'

export const authenticatedNavigationItems = [
  {
    label: 'Dashboard',
    description: 'Visao geral',
    to: '/',
    icon: LayoutDashboard,
    isVisible: ({ permissions }) => canAccessDashboard(permissions),
  },
  {
    label: 'Processos',
    description: 'Fluxo principal',
    to: '/processos',
    icon: ClipboardCheck,
  },
  {
    label: 'Titulares Caixa',
    description: 'Contratos e quitacao',
    to: '/titulares-caixa',
    icon: FileSpreadsheet,
    isVisible: ({ permissions }) => canViewTitularesCaixa(permissions),
  },
  {
    label: 'Cadastros',
    description: 'Area administrativa',
    to: '/cadastros',
    icon: UserPlus,
    isVisible: ({ permissions }) => permissions.isAdmin,
  },
  {
    label: 'Seguranca',
    description: 'Logins e sessoes',
    to: '/seguranca',
    icon: ShieldCheck,
    isVisible: ({ permissions }) => permissions.isAdmin,
  },
  {
    label: 'Configuracoes',
    description: 'Ajustes do sistema',
    to: '/configuracoes',
    icon: Settings,
    isVisible: ({ permissions }) => permissions.isAdmin,
  },
] satisfies readonly AuthenticatedNavigationItem[]
