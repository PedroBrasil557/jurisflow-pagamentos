import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildStorageObjectKey,
  deleteStorageObject,
  getStorageObjectBytes,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import { process } from '../processes/processes.schema'
import {
  financeAttachment,
  financeCredit,
  financePayout,
  financeReceipt,
  financeReserveMovement,
} from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  type FinanceFlag,
  FinanceServiceError,
  sha256,
  writeAudit,
} from './finance.support'

// Comprovantes privados: objeto no S3 compativel sem ACL publica; download so
// passa por esta API, que reaplica autorizacao e escopo a cada acesso.

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const allowedTypes: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
}

export type AttachmentOwner =
  | { kind: 'receipt'; id: string }
  | { kind: 'payout'; id: string }
  | { kind: 'reserve'; id: string }

const ownerFlag: Record<AttachmentOwner['kind'], FinanceFlag> = {
  receipt: 'lancar',
  payout: 'baixar',
  reserve: 'reservas',
}

/** Resolve o processo do dono e checa visibilidade (404 fora do escopo). */
async function assertOwnerVisible(
  access: FinanceAccess,
  owner: AttachmentOwner,
) {
  const visible = (processId: string | null) => async () => {
    if (!processId) {
      if (!access.isGlobal) {
        throw new FinanceServiceError(404, 'Registro não encontrado.')
      }
      return
    }
    const [row] = await db
      .select({ id: process.id })
      .from(process)
      .where(
        access.processFilter
          ? and(eq(process.id, processId), access.processFilter)
          : eq(process.id, processId),
      )
    if (!row) throw new FinanceServiceError(404, 'Registro não encontrado.')
  }
  if (owner.kind === 'receipt') {
    const [row] = await db
      .select({ processId: financeReceipt.processId })
      .from(financeReceipt)
      .where(eq(financeReceipt.id, owner.id))
    if (!row) throw new FinanceServiceError(404, 'Recebimento não encontrado.')
    return visible(row.processId)()
  }
  if (owner.kind === 'payout') {
    const [row] = await db
      .select({ processId: financeCredit.processId })
      .from(financePayout)
      .innerJoin(financeCredit, eq(financePayout.creditId, financeCredit.id))
      .where(eq(financePayout.id, owner.id))
    if (!row) throw new FinanceServiceError(404, 'Baixa não encontrada.')
    return visible(row.processId)()
  }
  const [row] = await db
    .select({ processId: financeReserveMovement.processId })
    .from(financeReserveMovement)
    .where(eq(financeReserveMovement.id, owner.id))
  if (!row) throw new FinanceServiceError(404, 'Movimento não encontrado.')
  return visible(row.processId)()
}

function detectMime(bytes: Uint8Array, declared: string): string | null {
  const signatures = allowedTypes[declared]
  if (!signatures) return null
  return signatures.some((sig) => sig.every((byte, i) => bytes[i] === byte))
    ? declared
    : null
}

function storageUnavailable(): never {
  throw new FinanceServiceError(
    503,
    'Armazenamento de comprovantes indisponível neste ambiente.',
  )
}

export async function uploadAttachment(
  access: FinanceAccess,
  owner: AttachmentOwner,
  file: { bytes: Uint8Array; name: string; type: string },
) {
  assertFinance(access, ownerFlag[owner.kind])
  await assertOwnerVisible(access, owner)
  if (file.bytes.byteLength === 0) {
    throw new FinanceServiceError(422, 'Arquivo vazio.')
  }
  if (file.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new FinanceServiceError(413, 'Comprovante acima de 10 MB.')
  }
  const mimeType = detectMime(file.bytes, file.type)
  if (!mimeType) {
    throw new FinanceServiceError(
      415,
      'Envie PDF, JPG ou PNG (o conteúdo do arquivo é verificado).',
    )
  }
  const id = crypto.randomUUID()
  const safeName =
    file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'comprovante'
  const objectKey = buildStorageObjectKey([
    'finance',
    owner.kind,
    owner.id,
    `${id}-${safeName}`,
  ])
  const bucketName = storageBuckets.processDocuments
  try {
    await uploadStorageObject({
      body: file.bytes,
      bucketName,
      contentType: mimeType,
      objectKey,
    })
  } catch (error) {
    console.error('finance attachment upload failed', { error: String(error) })
    storageUnavailable()
  }
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(financeAttachment)
        .values({
          id,
          receiptId: owner.kind === 'receipt' ? owner.id : null,
          payoutId: owner.kind === 'payout' ? owner.id : null,
          reserveMovementId: owner.kind === 'reserve' ? owner.id : null,
          bucketName,
          objectKey,
          originalFileName: file.name.slice(0, 200),
          mimeType,
          sizeInBytes: file.bytes.byteLength,
          sha256: sha256(file.bytes),
          uploadedByUserId: access.actor.id,
        })
        .returning({
          id: financeAttachment.id,
          originalFileName: financeAttachment.originalFileName,
          mimeType: financeAttachment.mimeType,
          sizeInBytes: financeAttachment.sizeInBytes,
          sha256: financeAttachment.sha256,
          uploadedAt: financeAttachment.uploadedAt,
        })
      await writeAudit(tx, {
        actor: access.actor,
        entityType: `${owner.kind}_attachment`,
        entityId: owner.id,
        action: 'COMPROVANTE_ANEXADO',
        after: created,
      })
      return created
    })
  } catch (error) {
    // Compensacao: sem linha no banco, o objeto nao pode ficar orfao.
    await deleteStorageObject({ bucketName, objectKey }).catch(() => {})
    throw error
  }
}

export async function listAttachments(
  access: FinanceAccess,
  owner: AttachmentOwner,
) {
  assertFinance(access, 'view')
  await assertOwnerVisible(access, owner)
  const column =
    owner.kind === 'receipt'
      ? financeAttachment.receiptId
      : owner.kind === 'payout'
        ? financeAttachment.payoutId
        : financeAttachment.reserveMovementId
  return db
    .select({
      id: financeAttachment.id,
      originalFileName: financeAttachment.originalFileName,
      mimeType: financeAttachment.mimeType,
      sizeInBytes: financeAttachment.sizeInBytes,
      sha256: financeAttachment.sha256,
      uploadedAt: financeAttachment.uploadedAt,
    })
    .from(financeAttachment)
    .where(and(eq(column, owner.id), isNull(financeAttachment.removedAt)))
}

export async function downloadAttachment(
  access: FinanceAccess,
  attachmentId: string,
) {
  assertFinance(access, 'view')
  const [row] = await db
    .select()
    .from(financeAttachment)
    .where(
      and(
        eq(financeAttachment.id, attachmentId),
        isNull(financeAttachment.removedAt),
      ),
    )
  if (!row) throw new FinanceServiceError(404, 'Comprovante não encontrado.')
  const owner: AttachmentOwner = row.receiptId
    ? { kind: 'receipt', id: row.receiptId }
    : row.payoutId
      ? { kind: 'payout', id: row.payoutId }
      : { kind: 'reserve', id: row.reserveMovementId as string }
  await assertOwnerVisible(access, owner)
  let bytes: Uint8Array
  try {
    bytes = await getStorageObjectBytes({
      bucketName: row.bucketName as typeof storageBuckets.processDocuments,
      objectKey: row.objectKey,
    })
  } catch (error) {
    console.error('finance attachment download failed', {
      error: String(error),
    })
    storageUnavailable()
  }
  if (sha256(bytes) !== row.sha256) {
    throw new FinanceServiceError(
      500,
      'Comprovante corrompido no armazenamento.',
    )
  }
  return { bytes, fileName: row.originalFileName, mimeType: row.mimeType }
}
