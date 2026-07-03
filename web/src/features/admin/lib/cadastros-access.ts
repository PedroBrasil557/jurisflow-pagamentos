import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

// Acesso a Cadastros e por permissao de perfil (grupo cadastros), nao por role
// fixa. Sem bypass de admin comum: a API ja resolve as flags (master = tudo
// true; admin comum = do perfil atribuido) — espelha os guards da API.

export function canManageUsuarios(permissions: ResolvedPermissions) {
  return permissions.permissions.cadastros.usuarios
}

export function canManageConjuntos(permissions: ResolvedPermissions) {
  return permissions.permissions.cadastros.conjuntos
}

export function canManagePermissoes(permissions: ResolvedPermissions) {
  return permissions.permissions.cadastros.permissoes
}

/** A pagina de Cadastros aparece se QUALQUER aba estiver liberada. */
export function canAccessCadastros(permissions: ResolvedPermissions) {
  return (
    canManageUsuarios(permissions) ||
    canManageConjuntos(permissions) ||
    canManagePermissoes(permissions)
  )
}
