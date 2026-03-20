import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type AuthenticatedLayoutUser = {
  name: string
  email: string
  role: string
}

export type AuthenticatedNavigationItem = {
  label: string
  description: string
  to: '/' | '/processos' | '/cadastros'
  icon: LucideIcon
  isVisible?: (role: string) => boolean
}

export type AuthenticatedBreadcrumbItem = {
  label: string
  to?: string
}

export type AuthenticatedLayoutProps = {
  children: ReactNode
  user: AuthenticatedLayoutUser
}
