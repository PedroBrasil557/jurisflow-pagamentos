import type {
  AuthenticatedBreadcrumbItem,
  AuthenticatedLayoutUser,
  AuthenticatedNavigationItem,
} from './authenticated-layout.types'

export function getUserInitials(name: string) {
  const [firstName = ''] = name.trim().split(/\s+/)

  return `${firstName[0] ?? ''}`.toUpperCase()
}

export function getVisibleNavigationItems(
  items: readonly AuthenticatedNavigationItem[],
  user: AuthenticatedLayoutUser,
) {
  return items.filter((item) =>
    item.isVisible ? item.isVisible(user.role) : true,
  )
}

export function getCurrentSection(
  pathname: string,
  items: readonly AuthenticatedNavigationItem[],
) {
  return getBreadcrumbItems(pathname, items).at(-1)?.label ?? 'Workspace'
}

export function getBreadcrumbItems(
  pathname: string,
  items: readonly AuthenticatedNavigationItem[],
) {
  const processesItem = items.find((item) => item.to === '/processos')
  const registersItem = items.find((item) => item.to === '/cadastros')
  const breadcrumbs: AuthenticatedBreadcrumbItem[] = []

  if (pathname === '/') {
    breadcrumbs.push({ label: 'Dashboard' })
    return breadcrumbs
  }

  if (pathname.startsWith('/processos')) {
    if (processesItem) {
      breadcrumbs.push({
        label: processesItem.label,
        to: pathname === '/processos' ? undefined : processesItem.to,
      })
    }

    if (pathname === '/processos') {
      return breadcrumbs
    }

    if (pathname.endsWith('/novo')) {
      breadcrumbs.push({ label: 'Novo processo' })
      return breadcrumbs
    }

    if (pathname.endsWith('/editar')) {
      breadcrumbs.push({ label: 'Editar processo' })
      return breadcrumbs
    }

    if (pathname.endsWith('/checklist')) {
      breadcrumbs.push({ label: 'Checklist' })
      return breadcrumbs
    }

    return breadcrumbs
  }

  if (pathname.startsWith('/cadastros')) {
    if (registersItem) {
      breadcrumbs.push({ label: registersItem.label })
    }

    return breadcrumbs
  }

  if (pathname.startsWith('/primeiro-acesso')) {
    breadcrumbs.push({ label: 'Primeiro acesso' })
    return breadcrumbs
  }

  breadcrumbs.push({
    label:
      items.find((item) =>
        item.to === '/' ? pathname === '/' : pathname.startsWith(item.to),
      )?.label ?? 'Workspace',
  })

  return breadcrumbs
}
