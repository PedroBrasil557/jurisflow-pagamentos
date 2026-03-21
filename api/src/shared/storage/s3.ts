import {
  DeleteObjectCommand,
  GetObjectCommand,
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

export async function createStorageObjectDownloadUrl(input: {
  bucketName: StorageBucketName
  expiresInSeconds?: number
  objectKey: string
}) {
  return getSignedUrl(
    publicStorageClient,
    new GetObjectCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
    }),
    {
      expiresIn: input.expiresInSeconds ?? 60 * 10,
    },
  )
}

export const s3Config = {
  accessKey: env.s3.accessKey,
  endpoint: env.s3.endpoint,
  forcePathStyle: env.s3.forcePathStyle,
  publicUrl: env.s3.publicUrl,
  region: env.s3.region,
  secretKey: env.s3.secretKey,
} as const
