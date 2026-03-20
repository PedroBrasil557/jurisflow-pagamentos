export const userRoles = ['user', 'admin', 'attorney'] as const

export type UserRole = (typeof userRoles)[number]

export const defaultUserRole: UserRole = 'user'

export function isUserRole(value: string): value is UserRole {
  return userRoles.includes(value as UserRole)
}
