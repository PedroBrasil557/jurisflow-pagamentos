import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

// Acesso a titulares Caixa e por permissao de perfil (grupo titularCaixa), nao
// por role fixa. Sem bypass de admin comum: a API ja resolve as flags (master
// = tudo true; admin comum = do perfil atribuido) — espelha o guard da API.

// Alem da flag titularCaixa.view, exige acesso a ALGUM conjunto: "para visualizar
// as informacoes de titular Caixa o usuario precisa ter permissao ao conjunto".
// admin/master e escopo 'all' veem tudo; demais escopos precisam de pelo menos um
// conjunto liberado (allowedHousingComplexIds). Espelha buildTitularesVisibilityFilter
// da API — sem conjunto liberado, a lista viria vazia; melhor esconder menu/aba.
export function canViewTitularesCaixa(permissions: ResolvedPermissions) {
  if (!permissions.permissions.titularCaixa.view) return false
  return (
    permissions.isAdmin ||
    permissions.processScope === 'all' ||
    permissions.allowedHousingComplexIds.length > 0
  )
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
