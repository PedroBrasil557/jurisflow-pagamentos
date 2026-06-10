import { db } from '../../shared/db'
import type {
  ProcessHistoryChangedFields,
  ProcessHistoryMetadata,
} from './processes.schema'
import { processHistory } from './processes.schema'
import type { ProcessStatus } from './processes.status'

type ProcessHistoryInsert = typeof processHistory.$inferInsert
type ProcessHistoryExecutor = Pick<typeof db, 'insert'>

export async function createProcessHistoryEntry(input: {
  processId: string
  actorUserId: string
  eventType: ProcessHistoryInsert['eventType']
  fromStatus?: ProcessStatus
  toStatus?: ProcessStatus
  changedFields?: ProcessHistoryChangedFields | null
  notes?: string | null
  metadata?: ProcessHistoryMetadata | null
  executor?: ProcessHistoryExecutor
}) {
  const executor = input.executor ?? db

  await executor.insert(processHistory).values({
    id: crypto.randomUUID(),
    processId: input.processId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    changedFields: input.changedFields ?? null,
    notes: input.notes ?? null,
    metadata: input.metadata ?? null,
  })
}
