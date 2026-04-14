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
