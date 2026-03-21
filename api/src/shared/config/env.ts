import { z } from 'zod'

function normalizeOrigin(origin: string) {
  return new URL(origin).origin
}

function expandLocalOriginAliases(origin: string) {
  const url = new URL(origin)
  const origins = [url.origin]

  if (url.hostname === 'localhost') {
    const localhostAlias = new URL(url.origin)
    localhostAlias.hostname = '127.0.0.1'
    origins.push(localhostAlias.origin)
  }

  if (url.hostname === '127.0.0.1') {
    const loopbackAlias = new URL(url.origin)
    loopbackAlias.hostname = 'localhost'
    origins.push(loopbackAlias.origin)
  }

  return origins
}

function parseTrustedOrigins(webUrl: string, trustedOrigins?: string) {
  const configuredOrigins = trustedOrigins
    ? trustedOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : []

  const allOrigins = [webUrl, ...configuredOrigins].flatMap((origin) =>
    expandLocalOriginAliases(normalizeOrigin(origin)),
  )

  return Array.from(new Set(allOrigins))
}

const envSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3556),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://postgres:postgres@localhost:3557/app'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, {
      message: 'BETTER_AUTH_SECRET precisa ter pelo menos 32 caracteres.',
    })
    .default('dev-only-secret-change-me-before-production'),
  BETTER_AUTH_URL: z.url().default('http://localhost:3556'),
  WEB_URL: z.url().default('http://localhost:3555'),
  TRUSTED_ORIGINS: z.string().optional(),
  S3_ENDPOINT: z.url().default('http://localhost:3558'),
  S3_PUBLIC_URL: z.url().default('http://localhost:3558'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin123'),
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  S3_PROCESS_DOCUMENTS_BUCKET: z
    .string()
    .trim()
    .min(3)
    .default('process-documents'),
})

const parsedEnv = envSchema.parse({
  HOST: process.env.HOST,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  WEB_URL: process.env.WEB_URL,
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_REGION: process.env.S3_REGION,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  S3_PROCESS_DOCUMENTS_BUCKET: process.env.S3_PROCESS_DOCUMENTS_BUCKET,
})

export const env = {
  host: parsedEnv.HOST,
  port: parsedEnv.PORT,
  databaseUrl: parsedEnv.DATABASE_URL,
  betterAuthSecret: parsedEnv.BETTER_AUTH_SECRET,
  betterAuthUrl: parsedEnv.BETTER_AUTH_URL,
  webUrl: parsedEnv.WEB_URL,
  trustedOrigins: parseTrustedOrigins(
    parsedEnv.WEB_URL,
    parsedEnv.TRUSTED_ORIGINS,
  ),
  s3: {
    endpoint: parsedEnv.S3_ENDPOINT,
    publicUrl: parsedEnv.S3_PUBLIC_URL,
    accessKey: parsedEnv.S3_ACCESS_KEY,
    secretKey: parsedEnv.S3_SECRET_KEY,
    region: parsedEnv.S3_REGION,
    forcePathStyle: parsedEnv.S3_FORCE_PATH_STYLE,
    buckets: {
      processDocuments: parsedEnv.S3_PROCESS_DOCUMENTS_BUCKET,
    },
  },
}
