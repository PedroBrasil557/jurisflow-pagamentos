import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildStorageObjectKey,
  createStorageObjectDownloadUrl,
  createStorageObjectInlineUrl,
  deleteStorageObject,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import { user } from '../auth/auth.schema'
import { isHousingComplexDocument } from '../processes/processes.documents'
import { HousingComplexServiceError } from './housing-complexes.errors'
import { housingComplex, housingComplexFile } from './housing-complexes.schema'

const MAX_FILE_SIZE_IN_BYTES = 25 * 1024 * 1024
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60

type Actor = { id: string }

function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
  return cleaned || 'arquivo'
}

async function assertComplexExists(housingComplexId: string) {
  const [row] = await db
    .select({ id: housingComplex.id })
    .from(housingComplex)
    .where(eq(housingComplex.id, housingComplexId))
    .limit(1)

  if (!row) {
    throw new HousingComplexServiceError(404, 'Conjunto nao encontrado.')
  }
}

function assertConjuntoDocumentKey(documentTypeKey: string) {
  if (!isHousingComplexDocument(documentTypeKey)) {
    throw new HousingComplexServiceError(
      400,
      'Tipo de documento invalido para o conjunto.',
    )
  }
}

export async function uploadHousingComplexFile(input: {
  housingComplexId: string
  documentTypeKey: string
  file: File
  actor: Actor
}) {
  assertConjuntoDocumentKey(input.documentTypeKey)
  await assertComplexExists(input.housingComplexId)

  if (input.file.size === 0) {
    throw new HousingComplexServiceError(400, 'O arquivo enviado esta vazio.')
  }
  if (input.file.size > MAX_FILE_SIZE_IN_BYTES) {
    throw new HousingComplexServiceError(
      413,
      'O arquivo excede o tamanho maximo de 25 MB.',
    )
  }

  const fileId = crypto.randomUUID()
  const bucketName = storageBuckets.processDocuments
  const mimeType = input.file.type || 'application/octet-stream'
  const objectKey = buildStorageObjectKey([
    'housing-complexes',
    input.housingComplexId,
    'documents',
    input.documentTypeKey,
    `${fileId}-${sanitizeFileName(input.file.name)}`,
  ])

  const bytes = new Uint8Array(await input.file.arrayBuffer())
  await uploadStorageObject({
    body: bytes,
    bucketName,
    contentType: mimeType,
    objectKey,
  })

  try {
    // Substituicao do arquivo corrente atomica: marca o anterior como nao-corrente
    // e insere o novo na mesma transacao (o indice unico parcial garante 1 corrente).
    await db.transaction(async (tx) => {
      await tx
        .update(housingComplexFile)
        .set({ isCurrent: false, replacedAt: new Date() })
        .where(
          and(
            eq(housingComplexFile.housingComplexId, input.housingComplexId),
            eq(housingComplexFile.documentTypeKey, input.documentTypeKey),
            eq(housingComplexFile.isCurrent, true),
          ),
        )

      await tx.insert(housingComplexFile).values({
        id: fileId,
        housingComplexId: input.housingComplexId,
        documentTypeKey: input.documentTypeKey,
        bucketName,
        objectKey,
        originalFileName: input.file.name,
        mimeType,
        sizeInBytes: input.file.size,
        isCurrent: true,
        uploadedByUserId: input.actor.id,
      })
    })
  } catch (error) {
    // Falhou o DB: remove o objeto recem-enviado para nao deixar orfao no storage.
    await deleteStorageObject({ bucketName, objectKey }).catch(() => undefined)
    throw error
  }

  return { id: fileId, documentTypeKey: input.documentTypeKey }
}

// Lista os arquivos correntes do conjunto (com URL de download assinada).
export async function listHousingComplexFiles(housingComplexId: string) {
  await assertComplexExists(housingComplexId)

  const rows = await db
    .select({
      id: housingComplexFile.id,
      documentTypeKey: housingComplexFile.documentTypeKey,
      bucketName: housingComplexFile.bucketName,
      objectKey: housingComplexFile.objectKey,
      originalFileName: housingComplexFile.originalFileName,
      mimeType: housingComplexFile.mimeType,
      sizeInBytes: housingComplexFile.sizeInBytes,
      uploadedAt: housingComplexFile.uploadedAt,
      uploadedBy: { id: user.id, name: user.name, role: user.role },
    })
    .from(housingComplexFile)
    .innerJoin(user, eq(housingComplexFile.uploadedByUserId, user.id))
    .where(
      and(
        eq(housingComplexFile.housingComplexId, housingComplexId),
        eq(housingComplexFile.isCurrent, true),
      ),
    )
    .orderBy(desc(housingComplexFile.uploadedAt))

  const items = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      documentTypeKey: row.documentTypeKey,
      originalFileName: row.originalFileName,
      mimeType: row.mimeType,
      sizeInBytes: row.sizeInBytes,
      uploadedAt: row.uploadedAt,
      uploadedBy: row.uploadedBy,
      downloadUrl: await createStorageObjectDownloadUrl({
        bucketName: row.bucketName,
        objectKey: row.objectKey,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      }),
    })),
  )

  return { items }
}

// URL pre-assinada INLINE de um arquivo do conjunto (viewer do checklist do
// processo busca os bytes direto do storage). Valida que o arquivo pertence ao
// conjunto informado (ownership) — o caller ja checou o acesso do usuario ao
// processo/checklist.
export async function getHousingComplexFilePreviewUrl(input: {
  housingComplexId: string
  fileId: string
}): Promise<{ url: string }> {
  const [row] = await db
    .select({
      bucketName: housingComplexFile.bucketName,
      objectKey: housingComplexFile.objectKey,
      mimeType: housingComplexFile.mimeType,
    })
    .from(housingComplexFile)
    .where(
      and(
        eq(housingComplexFile.id, input.fileId),
        eq(housingComplexFile.housingComplexId, input.housingComplexId),
        eq(housingComplexFile.isCurrent, true),
      ),
    )
    .limit(1)

  if (!row) {
    throw new HousingComplexServiceError(404, 'Arquivo nao encontrado.')
  }

  const url = await createStorageObjectInlineUrl({
    bucketName: row.bucketName,
    objectKey: row.objectKey,
    contentType: row.mimeType,
  })
  return { url }
}

export async function deleteHousingComplexFile(input: {
  housingComplexId: string
  fileId: string
}) {
  const [fileRow] = await db
    .select({
      id: housingComplexFile.id,
      bucketName: housingComplexFile.bucketName,
      objectKey: housingComplexFile.objectKey,
    })
    .from(housingComplexFile)
    .where(
      and(
        eq(housingComplexFile.id, input.fileId),
        eq(housingComplexFile.housingComplexId, input.housingComplexId),
      ),
    )
    .limit(1)

  if (!fileRow) {
    throw new HousingComplexServiceError(404, 'Arquivo nao encontrado.')
  }

  // Apaga o objeto primeiro (S3 delete e idempotente). Se falhar, a linha
  // permanece e a operacao pode ser repetida — evita orfao sem referencia.
  await deleteStorageObject({
    bucketName: fileRow.bucketName,
    objectKey: fileRow.objectKey,
  })

  await db
    .delete(housingComplexFile)
    .where(eq(housingComplexFile.id, fileRow.id))
}

export type HousingComplexChecklistFile = {
  id: string
  originalFileName: string
  mimeType: string
  sizeInBytes: number
  uploadedAt: Date
  uploadedBy: { id: string; name: string; role: string }
  downloadUrl: string
  bucketName: string
  objectKey: string
}

// Arquivos correntes do conjunto por tipo, com URL assinada — usado para
// espelhar no checklist do processo (respeita o acesso ja validado no checklist).
export async function getHousingComplexChecklistFiles(
  housingComplexId: string,
): Promise<Map<string, HousingComplexChecklistFile>> {
  const rows = await db
    .select({
      id: housingComplexFile.id,
      documentTypeKey: housingComplexFile.documentTypeKey,
      bucketName: housingComplexFile.bucketName,
      objectKey: housingComplexFile.objectKey,
      originalFileName: housingComplexFile.originalFileName,
      mimeType: housingComplexFile.mimeType,
      sizeInBytes: housingComplexFile.sizeInBytes,
      uploadedAt: housingComplexFile.uploadedAt,
      uploadedBy: { id: user.id, name: user.name, role: user.role },
    })
    .from(housingComplexFile)
    .innerJoin(user, eq(housingComplexFile.uploadedByUserId, user.id))
    .where(
      and(
        eq(housingComplexFile.housingComplexId, housingComplexId),
        eq(housingComplexFile.isCurrent, true),
      ),
    )

  const byKey = new Map<string, HousingComplexChecklistFile>()
  for (const row of rows) {
    byKey.set(row.documentTypeKey, {
      id: row.id,
      originalFileName: row.originalFileName,
      mimeType: row.mimeType,
      sizeInBytes: row.sizeInBytes,
      uploadedAt: row.uploadedAt,
      uploadedBy: row.uploadedBy,
      bucketName: row.bucketName,
      objectKey: row.objectKey,
      downloadUrl: await createStorageObjectDownloadUrl({
        bucketName: row.bucketName,
        objectKey: row.objectKey,
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      }),
    })
  }

  return byKey
}
