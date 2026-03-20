import { useLocation, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar'
import { authClient } from '@/features/auth/services/auth-client'
import { AuthenticatedHeader } from './authenticated-header'
import { authenticatedNavigationItems } from './authenticated-layout.navigation'
import type { AuthenticatedLayoutProps } from './authenticated-layout.types'
import {
  getBreadcrumbItems,
  getUserInitials,
  getVisibleNavigationItems,
} from './authenticated-layout.utils'
import { AuthenticatedSidebar } from './authenticated-sidebar'

export function AuthenticatedLayout({
  children,
  user,
}: AuthenticatedLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    if (isSigningOut) {
      return
    }

    setIsSigningOut(true)

    try {
      await authClient.signOut()
      await navigate({ to: '/login' })
    } finally {
      setIsSigningOut(false)
    }
  }

  const navigationItems = getVisibleNavigationItems(
    authenticatedNavigationItems,
    user,
  )
  const userInitials = getUserInitials(user.name)
  const breadcrumbs = getBreadcrumbItems(location.pathname, navigationItems)

  return (
    <SidebarProvider>
      <AuthenticatedSidebar
        isSigningOut={isSigningOut}
        navigationItems={navigationItems}
        onSignOut={handleSignOut}
      />
      <SidebarInset>
        <AuthenticatedHeader
          breadcrumbs={breadcrumbs}
          isSigningOut={isSigningOut}
          onSignOut={handleSignOut}
          user={user}
          userInitials={userInitials}
        />
        <div className="flex-1 px-4 py-6 sm:px-6 xl:px-8">
          <div className="mx-auto w-full max-w-400">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
