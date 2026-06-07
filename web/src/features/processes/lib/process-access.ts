import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'

export type ProcessRelationship = {
  isCreator: boolean
  isDocumentationAssignee: boolean
  isInScope: boolean
}

type ProcessAccessRecord = {
  createdByUserId: string
  documentationAssigneeId: string | null
  housingComplexId: string | null
}

export function buildProcessRelationship(input: {
  process: ProcessAccessRecord
  userId: string
  permissions: ResolvedPermissions
}): ProcessRelationship {
  const isCreator = input.process.createdByUserId === input.userId
  const isDocumentationAssignee =
    input.process.documentationAssigneeId === input.userId

  let isInScope = false

  if (input.permissions.isAdmin || input.permissions.processScope === 'all') {
    isInScope = true
  } else if (input.permissions.processScope === 'housing_complex') {
    isInScope =
      isCreator ||
      (input.process.housingComplexId !== null &&
        input.permissions.allowedHousingComplexIds.includes(
          input.process.housingComplexId,
        ))
  } else {
    isInScope = isCreator
  }

  return { isCreator, isDocumentationAssignee, isInScope }
}

export function canCreateProcess(permissions: ResolvedPermissions) {
  return permissions.isAdmin || permissions.permissions.process.create
}

// O fluxo "Escanear documentos" cria o processo E anexa documentos no checklist;
// so faz sentido para quem pode criar e anexar (senao a ingestao IA falharia).
export function canCreateProcessViaScan(permissions: ResolvedPermissions) {
  return (
    permissions.isAdmin ||
    (permissions.permissions.process.create &&
      permissions.permissions.process.uploadChecklist)
  )
}

export function canAccessDashboard(permissions: ResolvedPermissions) {
  return permissions.isAdmin || permissions.permissions.sections.dashboard
}

export function canAccessChecklist(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return (
    relationship.isInScope &&
    (permissions.permissions.sections.checklist ||
      permissions.permissions.sections.documentation)
  )
}

export function canAccessDocumentation(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return (
    relationship.isInScope && permissions.permissions.sections.documentation
  )
}

export function canAccessBatch(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return (
    (relationship.isInScope || relationship.isCreator) &&
    permissions.permissions.sections.batch &&
    permissions.permissions.process.viewBatch
  )
}

export function canAccessHistory(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return relationship.isInScope && permissions.permissions.sections.history
}

export function canEditProcess(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    (relationship.isCreator && permissions.permissions.process.editOwn) ||
    (relationship.isInScope && permissions.permissions.process.editAny)
  )
}

export function canCancelProcess(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    (relationship.isCreator && permissions.permissions.process.cancelOwn) ||
    (relationship.isInScope && permissions.permissions.process.cancelAny)
  )
}

export function canStartLegal(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    (relationship.isInScope && permissions.permissions.process.startLegal)
  )
}

export function canEditLegal(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    (relationship.isInScope && permissions.permissions.process.editLegal)
  )
}

export function canFinalizeProcess(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    (relationship.isInScope && permissions.permissions.process.finalize)
  )
}

export function canGeneratePdf(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return relationship.isInScope && permissions.permissions.process.generatePdf
}

export function canViewProcessDetails(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    relationship.isInScope ||
    relationship.isDocumentationAssignee
  )
}

export function canManageChecklist(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return (
    relationship.isInScope && permissions.permissions.process.uploadChecklist
  )
}

export function canDeleteChecklistFiles(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return (
    relationship.isInScope &&
    permissions.permissions.process.deleteChecklistFile
  )
}

export function canMarkDocumentationReady(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  if (permissions.isAdmin) return true
  if (relationship.isDocumentationAssignee) return true

  return (
    relationship.isInScope &&
    permissions.permissions.process.markDocumentationReady
  )
}

export function canUploadBatchFiles(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    ((relationship.isInScope || relationship.isCreator) &&
      permissions.permissions.process.uploadBatch)
  )
}

export function canDeleteBatchFiles(
  permissions: ResolvedPermissions,
  relationship: ProcessRelationship,
) {
  return (
    permissions.isAdmin ||
    ((relationship.isInScope || relationship.isCreator) &&
      permissions.permissions.process.deleteBatch)
  )
}
