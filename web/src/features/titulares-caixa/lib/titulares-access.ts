import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

// Acesso a titulares Caixa e por permissao de perfil (grupo titularCaixa), nao
// por role fixa. Admins sempre passam — espelha o guard da API.

export function canViewTitularesCaixa(permissions: ResolvedPermissions) {
  return permissions.isAdmin || permissions.permissions.titularCaixa.view
}

export function canExportTitulares(permissions: ResolvedPermissions) {
  return permissions.isAdmin || permissions.permissions.titularCaixa.export
}

export function canImportTitulares(permissions: ResolvedPermissions) {
  return permissions.isAdmin || permissions.permissions.titularCaixa.import
}

export function canReconsultarTitulares(permissions: ResolvedPermissions) {
  return permissions.isAdmin || permissions.permissions.titularCaixa.reconsultar
}
