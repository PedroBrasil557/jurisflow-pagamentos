import { eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  assertCanViewProcess,
  buildProcessRelationship,
} from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import { ProcessServiceError } from './processes.errors'
import { process } from './processes.schema'

export function buildProcessVisibilityFilter(
  userId: string,
  perms: ResolvedPermissions,
): SQL | undefined {
  if (perms.isAdmin || perms.processScope === 'all') {
    return undefined
  }

  if (perms.processScope === 'housing_complex') {
    const allowedIds = perms.allowedHousingComplexIds

    return or(
      allowedIds.length > 0
        ? inArray(process.housingComplexId, allowedIds)
        : sql`false`,
      eq(process.createdByUserId, userId),
      eq(process.documentationAssigneeId, userId),
    )
  }

  return or(
    eq(process.createdByUserId, userId),
    eq(process.documentationAssigneeId, userId),
  )
}

export async function getProcessRecordOrThrow(processId: string) {
  const [currentProcess] = await db
    .select()
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)

  if (!currentProcess) {
    throw new ProcessServiceError(404, 'Processo nao encontrado.')
  }

  return currentProcess
}

export async function getProcessContextOrThrow(input: {
  processId: string
  userId: string
  perms: ResolvedPermissions
}) {
  const currentProcess = await getProcessRecordOrThrow(input.processId)
  const relationship = buildProcessRelationship(
    currentProcess,
    input.userId,
    input.perms,
  )

  return {
    process: currentProcess,
    relationship,
  }
}

export async function getAccessibleProcessContextOrThrow(input: {
  processId: string
  userId: string
  perms: ResolvedPermissions
}) {
  const context = await getProcessContextOrThrow(input)
  assertCanViewProcess(input.perms, context.relationship)

  return context
}
