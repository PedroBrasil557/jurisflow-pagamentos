import type { ProcessScope, ProfilePermissions } from './permissions.types'

export type SystemProfileKey = 'default_user' | 'attorney'

export const SYSTEM_PROFILE_IDS = {
  attorney: 'system_profile_attorney',
  default_user: 'system_profile_default_user',
} as const satisfies Record<SystemProfileKey, string>

export type SystemProfileDefinition = {
  key: SystemProfileKey
  name: string
  description: string
  processScope: ProcessScope
  permissions: ProfilePermissions
}

export const DEFAULT_USER_PERMISSIONS: ProfilePermissions = {
  process: {
    create: true,
    viewOwn: true,
    editOwn: true,
    editAny: false,
    startLegal: false,
    editLegal: false,
    finalize: false,
    cancelOwn: true,
    cancelAny: false,
    markDocumentationReady: false,
    uploadChecklist: false,
    deleteChecklistFile: false,
    viewBatch: true,
    uploadBatch: true,
    deleteBatch: false,
    generatePdf: true,
  },
  sections: {
    dashboard: true,
    checklist: true,
    documentation: false,
    legalData: false,
    history: true,
    batch: true,
  },
  titularCaixa: {
    view: false,
    export: false,
    import: false,
    reconsultar: false,
  },
}

export const ATTORNEY_PERMISSIONS: ProfilePermissions = {
  process: {
    create: true,
    viewOwn: true,
    editOwn: true,
    editAny: true,
    startLegal: true,
    editLegal: true,
    finalize: true,
    cancelOwn: true,
    cancelAny: true,
    markDocumentationReady: true,
    uploadChecklist: true,
    deleteChecklistFile: true,
    viewBatch: true,
    uploadBatch: true,
    deleteBatch: true,
    generatePdf: true,
  },
  sections: {
    dashboard: true,
    checklist: true,
    documentation: true,
    legalData: true,
    history: true,
    batch: true,
  },
  titularCaixa: {
    view: false,
    export: false,
    import: false,
    reconsultar: false,
  },
}

export const SYSTEM_PROFILES: SystemProfileDefinition[] = [
  {
    key: 'default_user',
    name: 'Usuário Padrão',
    description:
      'Perfil padrão para novos usuários. Permite criar e gerenciar processos próprios.',
    processScope: 'own',
    permissions: DEFAULT_USER_PERMISSIONS,
  },
  {
    key: 'attorney',
    name: 'Advogado',
    description:
      'Acesso completo a todos os processos, incluindo ações jurídicas.',
    processScope: 'all',
    permissions: ATTORNEY_PERMISSIONS,
  },
]

/** Permissões de fallback quando o usuário não tem perfil atribuído */
export const FALLBACK_PERMISSIONS: ProfilePermissions = DEFAULT_USER_PERMISSIONS

// Esqueleto tudo-false: fonte da forma canônica de ProfilePermissions para a
// normalização abaixo (grupos/chaves e o default de negação).
const DENY_ALL_PERMISSIONS: ProfilePermissions = {
  process: {
    create: false,
    viewOwn: false,
    editOwn: false,
    editAny: false,
    startLegal: false,
    editLegal: false,
    finalize: false,
    cancelOwn: false,
    cancelAny: false,
    markDocumentationReady: false,
    uploadChecklist: false,
    deleteChecklistFile: false,
    viewBatch: false,
    uploadBatch: false,
    deleteBatch: false,
    generatePdf: false,
  },
  sections: {
    dashboard: false,
    checklist: false,
    documentation: false,
    legalData: false,
    history: false,
    batch: false,
  },
  titularCaixa: {
    view: false,
    export: false,
    import: false,
    reconsultar: false,
  },
}

/**
 * Normaliza o JSON de permissões persistido no banco para a forma atual do
 * tipo. Perfis gravados antes de um grupo/chave existir (ex.: titularCaixa)
 * não têm a chave no JSON — ela cai para false (negar por padrão), em vez de
 * explodir com undefined. Toda leitura de permissions do banco passa por aqui.
 */
export function normalizeProfilePermissions(raw: unknown): ProfilePermissions {
  const source = (raw ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >
  const normalized = structuredClone(DENY_ALL_PERMISSIONS) as unknown as Record<
    string,
    Record<string, boolean>
  >

  for (const [group, keys] of Object.entries(normalized)) {
    for (const key of Object.keys(keys)) {
      const value = source[group]?.[key]
      if (typeof value === 'boolean') {
        keys[key] = value
      }
    }
  }

  return normalized as unknown as ProfilePermissions
}
