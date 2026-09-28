import { eq } from 'drizzle-orm'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { user } from '../auth/auth.schema'
import {
  FALLBACK_PERMISSIONS,
  normalizeProfilePermissions,
} from './permissions.defaults'
import {
  permissionProfile,
  profileHousingComplex,
  userHousingComplex,
  userProfile,
  userTitularMunicipio,
  userTitularUf,
} from './permissions.schema'
import type {
  ProcessRelationship,
  ProfilePermissions,
  ResolvedPermissions,
} from './permissions.types'

export async function resolveUserPermissions(
  userId: string,
  userRole: string,
): Promise<ResolvedPermissions> {
  if (userRole === 'admin') {
    // MASTER (CPF em MASTER_ADMIN_CPFS) tem bypass total. Admin comum mantem os
    // poderes administrativos, mas titulares Caixa e Cadastros vem do PERFIL
    // atribuido — sem perfil (ou sem as flags), nao acessa.
    const [row] = await db
      .select({ username: user.username })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const isMaster =
      row?.username != null && env.masterAdminCpfs.includes(row.username)

    const adminPermissions = buildAdminPermissions()
    let profileId: string | null = null
    let profileName: string | null = null

    if (!isMaster) {
      const [assignment] = await db
        .select({
          profileId: userProfile.profileId,
          profileName: permissionProfile.name,
          permissions: permissionProfile.permissions,
        })
        .from(userProfile)
        .innerJoin(
          permissionProfile,
          eq(userProfile.profileId, permissionProfile.id),
        )
        .where(eq(userProfile.userId, userId))
        .limit(1)

      const profilePermissions = normalizeProfilePermissions(
        assignment?.permissions,
      )
      adminPermissions.titularCaixa = profilePermissions.titularCaixa
      adminPermissions.cadastros = profilePermissions.cadastros
      adminPermissions.financeiro = profilePermissions.financeiro
      profileId = assignment?.profileId ?? null
      profileName = assignment?.profileName ?? null
    }

    return {
      isAdmin: true,
      isMaster,
      processScope: 'all',
      allowedHousingComplexIds: [],
      allowedUfs: [],
      allowedMunicipios: [],
      permissions: adminPermissions,
      profileId,
      profileName,
    }
  }

  const [assignment] = await db
    .select({
      profileId: userProfile.profileId,
      profileName: permissionProfile.name,
      processScope: permissionProfile.processScope,
      permissions: permissionProfile.permissions,
    })
    .from(userProfile)
    .innerJoin(
      permissionProfile,
      eq(userProfile.profileId, permissionProfile.id),
    )
    .where(eq(userProfile.userId, userId))
    .limit(1)

  const profileComplexIds =
    assignment?.processScope === 'housing_complex'
      ? await db
          .select({ housingComplexId: profileHousingComplex.housingComplexId })
          .from(profileHousingComplex)
          .where(eq(profileHousingComplex.profileId, assignment.profileId))
          .then((rows) => rows.map((r) => r.housingComplexId))
      : []

  const userComplexIds = await db
    .select({ housingComplexId: userHousingComplex.housingComplexId })
    .from(userHousingComplex)
    .where(eq(userHousingComplex.userId, userId))
    .then((rows) => rows.map((r) => r.housingComplexId))

  const allowedHousingComplexIds = [
    ...new Set([...profileComplexIds, ...userComplexIds]),
  ]

  // Grants geograficos do usuario (Titular Caixa) — sempre carregados (ungated,
  // como os grants diretos de conjunto). Aditivos ao acesso por conjunto.
  const allowedUfs = await db
    .select({ uf: userTitularUf.uf })
    .from(userTitularUf)
    .where(eq(userTitularUf.userId, userId))
    .then((rows) => rows.map((r) => r.uf))

  const allowedMunicipios = await db
    .select({
      uf: userTitularMunicipio.uf,
      municipio: userTitularMunicipio.municipio,
    })
    .from(userTitularMunicipio)
    .where(eq(userTitularMunicipio.userId, userId))

  if (!assignment) {
    return {
      isAdmin: false,
      isMaster: false,
      processScope: 'own',
      allowedHousingComplexIds,
      allowedUfs,
      allowedMunicipios,
      permissions: FALLBACK_PERMISSIONS,
      profileId: null,
      profileName: null,
    }
  }

  return {
    isAdmin: false,
    isMaster: false,
    processScope: assignment.processScope,
    allowedHousingComplexIds,
    allowedUfs,
    allowedMunicipios,
    permissions: normalizeProfilePermissions(assignment.permissions),
    profileId: assignment.profileId,
    profileName: assignment.profileName,
  }
}

function buildAdminPermissions(): ProfilePermissions {
  return {
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
      view: true,
      export: true,
      import: true,
      reconsultar: true,
    },
    cadastros: {
      usuarios: true,
      conjuntos: true,
      permissoes: true,
    },
    // So chega a admin comum sobrescrito pelo perfil (acima); MASTER mantem tudo.
    financeiro: {
      view: true,
      lancar: true,
      conferir: true,
      fechar: true,
      baixar: true,
      regras: true,
      reservas: true,
      exportar: true,
    },
  }
}

/**
 * Verifica uma permissão de titulares Caixa. Sem bypass de admin comum: as
 * flags já chegam resolvidas (master = tudo true; admin comum = do perfil).
 */
export function assertTitularCaixaCan(
  perms: ResolvedPermissions,
  action: keyof ProfilePermissions['titularCaixa'],
): void {
  if (!perms.permissions.titularCaixa[action]) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para executar esta acao.',
    )
  }
}

/**
 * Verifica uma permissão do grupo Cadastros (ex.: conjuntos). Sem bypass de admin
 * comum: as flags já chegam resolvidas (master = tudo true; admin comum = do perfil).
 */
export function assertCadastrosCan(
  perms: ResolvedPermissions,
  action: keyof ProfilePermissions['cadastros'],
): void {
  if (!perms.permissions.cadastros[action]) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para executar esta acao.',
    )
  }
}

/**
 * Verifica uma permissão genérica do perfil. Admins sempre passam.
 */
export function assertCan(
  perms: ResolvedPermissions,
  action: keyof ProfilePermissions['process'],
): void {
  if (perms.isAdmin) return
  if (!perms.permissions.process[action]) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para executar esta acao.',
    )
  }
}

/**
 * Verifica permissão considerando a relação do usuário com um processo específico.
 * Garante que a ação seja válida tanto para o perfil quanto para a relação.
 */
export function assertProcessAction(
  perms: ResolvedPermissions,
  rel: ProcessRelationship,
  action:
    | 'edit'
    | 'cancel'
    | 'uploadChecklist'
    | 'deleteChecklistFile'
    | 'uploadBatch'
    | 'deleteBatch'
    | 'viewBatch'
    | 'generatePdf'
    | 'startLegal'
    | 'editLegal'
    | 'finalize'
    | 'markDocumentationReady',
): void {
  if (perms.isAdmin) return

  switch (action) {
    case 'edit': {
      const canEditOwn = rel.isCreator && perms.permissions.process.editOwn
      const canEditAny = rel.isInScope && perms.permissions.process.editAny
      if (!canEditOwn && !canEditAny) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para editar este processo.',
        )
      }
      break
    }
    case 'cancel': {
      const canCancelOwn = rel.isCreator && perms.permissions.process.cancelOwn
      const canCancelAny = rel.isInScope && perms.permissions.process.cancelAny
      if (!canCancelOwn && !canCancelAny) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para cancelar este processo.',
        )
      }
      break
    }
    case 'uploadChecklist': {
      if (rel.isDocumentationAssignee) break
      if (!rel.isInScope || !perms.permissions.process.uploadChecklist) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para enviar documentos neste processo.',
        )
      }
      break
    }
    case 'deleteChecklistFile': {
      if (rel.isDocumentationAssignee) break
      if (!rel.isInScope || !perms.permissions.process.deleteChecklistFile) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para excluir documentos neste processo.',
        )
      }
      break
    }
    case 'viewBatch': {
      if (rel.isDocumentationAssignee) break
      const hasAccess = rel.isInScope || rel.isCreator
      if (!hasAccess || !perms.permissions.process.viewBatch) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para ver os arquivos em lote deste processo.',
        )
      }
      break
    }
    case 'uploadBatch': {
      const hasAccess = rel.isInScope || rel.isCreator
      if (!hasAccess || !perms.permissions.process.uploadBatch) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para enviar arquivos em lote neste processo.',
        )
      }
      break
    }
    case 'deleteBatch': {
      const hasAccess = rel.isInScope || rel.isCreator
      if (!hasAccess || !perms.permissions.process.deleteBatch) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para excluir arquivos em lote deste processo.',
        )
      }
      break
    }
    case 'markDocumentationReady': {
      if (rel.isDocumentationAssignee) break
      if (!rel.isInScope || !perms.permissions.process.markDocumentationReady) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para executar esta acao.',
        )
      }
      break
    }
    case 'generatePdf': {
      if (rel.isDocumentationAssignee) break
      if (!rel.isInScope || !perms.permissions.process.generatePdf) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para executar esta acao.',
        )
      }
      break
    }
    case 'startLegal':
    case 'editLegal':
    case 'finalize': {
      if (!rel.isInScope || !perms.permissions.process[action]) {
        throw new ServiceError(
          403,
          'Voce nao tem permissao para executar esta acao.',
        )
      }
      break
    }
  }
}

/**
 * Verifica se o usuário pode acessar a aba de documentação de um processo específico.
 */
export function assertCanAccessDocumentation(
  perms: ResolvedPermissions,
  rel: ProcessRelationship,
): void {
  if (perms.isAdmin) return
  if (rel.isDocumentationAssignee) return
  if (!rel.isInScope || !perms.permissions.sections.documentation) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para acessar a documentacao deste processo.',
    )
  }
}

export function assertCanViewProcess(
  perms: ResolvedPermissions,
  rel: ProcessRelationship,
): void {
  if (perms.isAdmin) return

  if (!rel.isInScope && !rel.isDocumentationAssignee) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para visualizar este processo.',
    )
  }
}

export function assertCanAccessChecklist(
  perms: ResolvedPermissions,
  rel: ProcessRelationship,
): void {
  if (perms.isAdmin) return
  if (rel.isDocumentationAssignee) return

  const hasInScopeAccess =
    rel.isInScope &&
    (perms.permissions.sections.checklist ||
      perms.permissions.sections.documentation)

  if (!hasInScopeAccess) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para acessar o checklist deste processo.',
    )
  }
}

export function assertCanAccessBatch(
  perms: ResolvedPermissions,
  rel: ProcessRelationship,
): void {
  if (perms.isAdmin) return
  if (rel.isDocumentationAssignee) return

  const hasAccess = rel.isInScope || rel.isCreator

  if (
    !hasAccess ||
    !perms.permissions.sections.batch ||
    !perms.permissions.process.viewBatch
  ) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para acessar os arquivos em lote deste processo.',
    )
  }
}

export function assertCanAccessHistory(
  perms: ResolvedPermissions,
  rel: ProcessRelationship,
): void {
  if (perms.isAdmin) return
  if (rel.isDocumentationAssignee) return

  if (!rel.isInScope || !perms.permissions.sections.history) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para acessar o historico deste processo.',
    )
  }
}

export function assertCanAccessDashboard(perms: ResolvedPermissions): void {
  if (perms.isAdmin) return

  if (!perms.permissions.sections.dashboard) {
    throw new ServiceError(
      403,
      'Voce nao tem permissao para acessar o dashboard.',
    )
  }
}

/**
 * Constrói o objeto ProcessRelationship para um processo específico.
 */
export function buildProcessRelationship(
  process: {
    createdByUserId: string
    documentationAssigneeId: string | null
    housingComplexId: string | null
  },
  userId: string,
  perms: ResolvedPermissions,
): ProcessRelationship {
  const isCreator = process.createdByUserId === userId
  const isDocumentationAssignee = process.documentationAssigneeId === userId

  let isInScope: boolean
  if (perms.isAdmin || perms.processScope === 'all') {
    isInScope = true
  } else if (perms.processScope === 'housing_complex') {
    isInScope =
      isCreator ||
      (process.housingComplexId !== null &&
        perms.allowedHousingComplexIds.includes(process.housingComplexId))
  } else {
    isInScope = isCreator
  }

  return { isCreator, isDocumentationAssignee, isInScope }
}
