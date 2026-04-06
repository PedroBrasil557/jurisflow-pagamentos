import { Link, useLocation } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '#/components/ui/sidebar'
import type { AuthenticatedNavigationItem } from './authenticated-layout.types'

type AuthenticatedSidebarProps = {
  isSigningOut: boolean
  navigationItems: readonly AuthenticatedNavigationItem[]
  onSignOut: () => void
}

export function AuthenticatedSidebar({
  isSigningOut,
  navigationItems,
  onSignOut,
}: AuthenticatedSidebarProps) {
  const location = useLocation()

  function isActive(item: AuthenticatedNavigationItem) {
    if (item.to === '/') {
      return location.pathname === '/'
    }

    return location.pathname.startsWith(item.to)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" className="no-underline" preload={false}>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                  JF
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">
                    JurisFlow
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigationItems.map((item) => {
                const Icon = item.icon

                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item)}
                      tooltip={item.label}
                    >
                      <Link
                        to={item.to}
                        className="no-underline"
                        preload={false}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={isSigningOut}
              onClick={onSignOut}
              tooltip="Encerrar sessao"
            >
              <LogOut />
              <span>{isSigningOut ? 'Saindo...' : 'Encerrar sessao'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
