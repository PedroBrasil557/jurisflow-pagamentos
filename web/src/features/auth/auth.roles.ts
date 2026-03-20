export const userRoles = ['user', 'admin', 'attorney'] as const

export type UserRole = (typeof userRoles)[number]

export const userRoleLabels: Record<UserRole, string> = {
  user: 'Usuario',
  admin: 'Administrador',
  attorney: 'Advogado',
}

export function isUserRole(value: string): value is UserRole {
  return userRoles.includes(value as UserRole)
}

export function isAdminRole(value: string) {
  return value === 'admin'
}

export function getUserRoleLabel(value: string) {
  if (isUserRole(value)) {
    return userRoleLabels[value]
  }

  return 'Perfil desconhecido'
}
