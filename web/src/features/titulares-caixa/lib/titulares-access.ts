import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

// Acesso a titulares Caixa e por permissao de perfil (grupo titularCaixa), nao
// por role fixa. Sem bypass de admin comum: a API ja resolve as flags (master
// = tudo true; admin comum = do perfil atribuido) — espelha o guard da API.

export function canViewTitularesCaixa(permissions: ResolvedPermissions) {
  return permissions.permissions.titularCaixa.view
}

export function canExportTitulares(permissions: ResolvedPermissions) {
  return permissions.permissions.titularCaixa.export
}

export function canImportTitulares(permissions: ResolvedPermissions) {
  return permissions.permissions.titularCaixa.import
}

export function canReconsultarTitulares(permissions: ResolvedPermissions) {
  return permissions.permissions.titularCaixa.reconsultar
}
