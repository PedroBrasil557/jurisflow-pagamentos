import { Link } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Separator } from '#/components/ui/separator'
import { SidebarTrigger } from '#/components/ui/sidebar'
import { getUserRoleLabel } from '@/features/auth/auth.roles'
import type {
  AuthenticatedBreadcrumbItem,
  AuthenticatedLayoutUser,
} from './authenticated-layout.types'
import { AuthenticatedThemeSwitcher } from './authenticated-theme-switcher'

type AuthenticatedHeaderProps = {
  breadcrumbs: readonly AuthenticatedBreadcrumbItem[]
  isSigningOut: boolean
  onSignOut: () => void
  user: AuthenticatedLayoutUser
  userInitials: string
}

export function AuthenticatedHeader({
  breadcrumbs,
  isSigningOut,
  onSignOut,
  user,
  userInitials,
}: AuthenticatedHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-xl">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />

      {breadcrumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((breadcrumb, index) => {
              const isLastItem = index === breadcrumbs.length - 1

              return (
                <BreadcrumbItem
                  key={`${breadcrumb.label}-${breadcrumb.to ?? index}`}
                >
                  {breadcrumb.to && !isLastItem ? (
                    <BreadcrumbLink asChild>
                      <Link
                        className="no-underline"
                        preload={false}
                        to={breadcrumb.to}
                      >
                        {breadcrumb.label}
                      </Link>
                    </BreadcrumbLink>
                  ) : (
                    <span className="text-muted-foreground">
                      {breadcrumb.label}
                    </span>
                  )}
                  {!isLastItem ? <BreadcrumbSeparator /> : null}
                </BreadcrumbItem>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <AuthenticatedThemeSwitcher />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-3 py-1">
                <Avatar className="size-9">
                  <AvatarFallback className="text-xs">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="mt-2">
                {getUserRoleLabel(user.role)}
              </Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isSigningOut} onClick={onSignOut}>
              <LogOut className="mr-2 size-4" />
              {isSigningOut ? 'Saindo...' : 'Encerrar sessao'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
