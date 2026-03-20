import { queryOptions } from '@tanstack/react-query'
import { type AdminUserListQuery, fetchAdminUsers } from './admin-users.service'

export const adminUserKeys = {
  all: ['admin-users'] as const,
  lists: () => [...adminUserKeys.all, 'list'] as const,
  list: (query: AdminUserListQuery) =>
    [...adminUserKeys.lists(), query] as const,
}

export function adminUserListOptions(query: AdminUserListQuery) {
  return queryOptions({
    queryKey: adminUserKeys.list(query),
    queryFn: () => fetchAdminUsers(query),
  })
}
