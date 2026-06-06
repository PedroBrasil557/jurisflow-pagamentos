import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

export type AuthenticatedLayoutUser = {
  name: string
  email: string
  role: string
}

export type AuthenticatedNavigationVisibilityInput = {
  permissions: ResolvedPermissions
  user: AuthenticatedLayoutUser
}

export type AuthenticatedNavigationItem = {
  label: string
  description: string
  to: '/' | '/processos' | '/cadastros' | '/configuracoes'
  icon: LucideIcon
  isVisible?: (input: AuthenticatedNavigationVisibilityInput) => boolean
}

export type AuthenticatedBreadcrumbItem = {
  label: string
  to?: string
}

export type AuthenticatedLayoutProps = {
  children: ReactNode
  permissions: ResolvedPermissions
  user: AuthenticatedLayoutUser
}
