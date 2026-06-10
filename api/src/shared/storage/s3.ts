import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env'

export const storageBuckets = {
  processDocuments: env.s3.buckets.processDocuments,
} as const

export type StorageBucketName =
  (typeof storageBuckets)[keyof typeof storageBuckets]

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeFileName(fileName: string) {
  return trimSlashes(fileName.trim())
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
}

export function buildStorageObjectKey(parts: readonly string[]) {
  return parts
    .map((part) => trimSlashes(part.trim()))
    .filter(Boolean)
    .join('/')
}

function normalizeLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

export function buildProcessDocumentObjectKey(input: {
  documentTypeKey: string
  documentTypeSortOrder: number
  documentTypeLabel: string
  fileId: string
  fileName: string
  processId: string
}) {
  const safeFileName = normalizeFileName(input.fileName) || 'arquivo'
  const sortPrefix = String(input.documentTypeSortOrder).padStart(2, '0')
  const safeLabel =
    normalizeLabel(input.documentTypeLabel) || input.documentTypeKey

  return buildStorageObjectKey([
    'processes',
    input.processId,
    'documents',
    `${sortPrefix}-${safeLabel}`,
    `${input.fileId}-${safeFileName}`,
  ])
}

export function buildProcessBatchObjectKey(input: {
  processId: string
  fileId: string
  fileName: string
}) {
  const safeFileName = normalizeFileName(input.fileName) || 'arquivo'

  return buildStorageObjectKey([
    'processes',
    input.processId,
    'batch',
    `${input.fileId}-${safeFileName}`,
  ])
}

// Area de STAGING do import pre-assinado: o browser sobe aqui primeiro. O
// complete copia para a chave definitiva (buildProcessBatchObjectKey) e apaga o
// staging. Objetos abandonados (presign sem complete) expiram via lifecycle
// (prefixo importStagingPrefix), entao nao viram lixo permanente no bucket.
export const importStagingPrefix = 'imports/staging'

export function buildImportStagingObjectKey(input: {
  processId: string
  fileId: string
  fileName: string
}) {
  const safeFileName = normalizeFileName(input.fileName) || 'arquivo'

  return buildStorageObjectKey([
    importStagingPrefix,
    input.processId,
    `${input.fileId}-${safeFileName}`,
  ])
}

export function buildProcessGeneratedDocumentObjectKey(input: {
  documentId: string
  fileName: string
  modelKey: string
  processId: string
}) {
  const safeFileName = normalizeFileName(input.fileName) || 'documento.pdf'

  return buildStorageObjectKey([
    'processes',
    input.processId,
    'generated',
    input.modelKey,
    `${input.documentId}-${safeFileName}`,
  ])
}

export function buildStorageObjectUrl(
  bucketName: StorageBucketName,
  objectKey: string,
) {
  const normalizedKey = buildStorageObjectKey([objectKey])
  const url = new URL(env.s3.publicUrl)

  url.pathname = buildStorageObjectKey([bucketName, normalizedKey])

  return url.toString()
}

function createStorageClient(endpoint: string) {
  const hasExplicitCredentials =
    env.s3.accessKey !== '' && env.s3.secretKey !== ''

  return new S3Client({
    region: env.s3.region,
    ...(env.s3.forcePathStyle ? { endpoint } : {}),
    ...(hasExplicitCredentials
      ? {
          credentials: {
            accessKeyId: env.s3.accessKey,
            secretAccessKey: env.s3.secretKey,
          },
        }
      : {}),
    forcePathStyle: env.s3.forcePathStyle,
  })
}

const internalStorageClient = createStorageClient(env.s3.endpoint)
const publicStorageClient = createStorageClient(env.s3.publicUrl)

export async function uploadStorageObject(input: {
  body: Uint8Array
  bucketName: StorageBucketName
  contentType: string
  objectKey: string
}) {
  await internalStorageClient.send(
    new PutObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
    }),
  )
}

export async function getStorageObjectBytes(input: {
  bucketName: StorageBucketName
  objectKey: string
}): Promise<Uint8Array> {
  const response = await internalStorageClient.send(
    new GetObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
    }),
  )

  if (!response.Body) {
    throw new Error('Objeto de storage vazio ou inexistente.')
  }

  return response.Body.transformToByteArray()
}

export async function deleteStorageObject(input: {
  bucketName: StorageBucketName
  objectKey: string
}) {
  await internalStorageClient.send(
    new DeleteObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
    }),
  )
}

// Monta o Content-Disposition de download. Inclui o filename* (RFC 5987) para
// nomes com acentos/UTF-8 (ex.: "João.zip"), com um fallback ASCII em filename.
// Remove CR/LF para nao permitir injecao de header.
function buildAttachmentDisposition(fileName: string): string {
  const clean = fileName.replace(/[\r\n"]/g, '')
  const asciiFallback = clean.replace(/[^\x20-\x7E]/g, '_')
  // encodeURIComponent deixa ' ( ) * sem encodar, mas eles nao sao validos no
  // ext-value do RFC 5987 — encoda-os tambem para nomes com apostrofo etc.
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

export async function createStorageObjectDownloadUrl(input: {
  bucketName: StorageBucketName
  expiresInSeconds?: number
  objectKey: string
  // Forca o navegador a baixar com este nome (mesmo cross-origin do S3).
  downloadFileName?: string
}) {
  return getSignedUrl(
    publicStorageClient,
    new GetObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      ResponseContentDisposition: input.downloadFileName
        ? buildAttachmentDisposition(input.downloadFileName)
        : undefined,
    }),
    {
      expiresIn: input.expiresInSeconds ?? 60 * 10,
    },
  )
}

// URL pre-assinada de UPLOAD (PUT): o browser sobe o arquivo DIRETO para o S3,
// sem passar pela API (contorna o teto de 10MB do API Gateway). Assinada com o
// client publico (endpoint que o browser alcanca). O contentType e o
// contentLength assinados sao OBRIGATORIOS no PUT: o S3 rejeita um corpo de
// tamanho diferente do assinado — isso TRAVA o tamanho do upload (sem isso, um
// presigned PUT aceita qualquer tamanho).
export async function createStorageObjectUploadUrl(input: {
  bucketName: StorageBucketName
  objectKey: string
  contentType: string
  contentLength: number
  expiresInSeconds?: number
}): Promise<string> {
  return getSignedUrl(
    publicStorageClient,
    new PutObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
    {
      expiresIn: input.expiresInSeconds ?? 60 * 10,
      // Garante que Content-Length entra nos headers ASSINADOS (e nao vira
      // unsigned/hoisted), para o S3 de fato exigir o tamanho exato.
      signableHeaders: new Set(['content-length']),
    },
  )
}

// Copia um objeto dentro do mesmo bucket (server-side, sem trafego de dados).
export async function copyStorageObject(input: {
  bucketName: StorageBucketName
  sourceObjectKey: string
  destinationObjectKey: string
}) {
  await internalStorageClient.send(
    new CopyObjectCommand({
      Bucket: input.bucketName,
      CopySource: `${input.bucketName}/${input.sourceObjectKey}`,
      Key: input.destinationObjectKey,
    }),
  )
}

// Le apenas os PRIMEIROS bytes de um objeto (Range GET) — barato, usado para
// conferir a assinatura de arquivo (magic bytes) sem baixar o arquivo todo.
export async function readStorageObjectPrefix(input: {
  bucketName: StorageBucketName
  objectKey: string
  length: number
}): Promise<Uint8Array> {
  const response = await internalStorageClient.send(
    new GetObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      Range: `bytes=0-${Math.max(0, input.length - 1)}`,
    }),
  )

  if (!response.Body) {
    throw new Error('Objeto de storage vazio ou inexistente.')
  }

  return response.Body.transformToByteArray()
}

// Confere se um objeto existe (e seu tamanho) — usado para validar um upload
// pre-assinado antes de registra-lo. Retorna null se nao existir.
export async function headStorageObject(input: {
  bucketName: StorageBucketName
  objectKey: string
}): Promise<{ sizeInBytes: number; contentType?: string } | null> {
  try {
    const response = await internalStorageClient.send(
      new HeadObjectCommand({
        Bucket: input.bucketName,
        Key: input.objectKey,
      }),
    )
    return {
      sizeInBytes: response.ContentLength ?? 0,
      contentType: response.ContentType,
    }
  } catch {
    return null
  }
}

export const s3Config = {
  accessKey: env.s3.accessKey,
  endpoint: env.s3.endpoint,
  forcePathStyle: env.s3.forcePathStyle,
  publicUrl: env.s3.publicUrl,
  region: env.s3.region,
  secretKey: env.s3.secretKey,
} as const
