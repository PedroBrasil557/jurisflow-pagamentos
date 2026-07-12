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
  BETTER_AUTH_URL: z.url().default('http://localhost:3555'),
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
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-opus-4-8'),
  // URL do microservico de realce do scan (scan-enhance). Vazio/ausente =
  // desligado (a ingestao segue com o PDF original, comportamento atual).
  // Exige esquema http(s): sem ele, 'scan-enhance:8000' passaria no parse de
  // URL (protocol 'scan-enhance:'), o boot aceitaria e todo fetch falharia
  // em silencio (best-effort engole) — misconfiguracao invisivel.
  SCAN_ENHANCE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .refine((value) => value === undefined || /^https?:\/\/\S+$/.test(value), {
      message: 'SCAN_ENHANCE_URL deve ser uma URL http(s) completa.',
    }),
  // Alvo de tamanho (bytes) por PDF de documento anexado no checklist (scans).
  // Abaixo do teto real do portal (~1,9 MB) com folga p/ overhead de container
  // do PDF. O microservico encoda-para-caber por pagina ate este alvo.
  CHECKLIST_FILE_MAX_BYTES: z.coerce.number().int().positive().default(1_800_000),
  GEOIP_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  GEOIP_API_URL: z.url().default('http://ip-api.com/json'),
  // Token compartilhado para os endpoints internos consumidos pelo worker RPA.
  INTERNAL_API_TOKEN: z.string().min(1).default('dev-internal-token-change-me'),
  // CPFs (separados por virgula) dos administradores MASTER: unicos com bypass
  // total de permissoes. Admins comuns recebem titulares Caixa via perfil.
  MASTER_ADMIN_CPFS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((cpf) => cpf.replace(/\D/g, ''))
        .filter(Boolean),
    ),
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
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  SCAN_ENHANCE_URL: process.env.SCAN_ENHANCE_URL,
  CHECKLIST_FILE_MAX_BYTES: process.env.CHECKLIST_FILE_MAX_BYTES,
  GEOIP_ENABLED: process.env.GEOIP_ENABLED,
  GEOIP_API_URL: process.env.GEOIP_API_URL,
  INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN,
  MASTER_ADMIN_CPFS: process.env.MASTER_ADMIN_CPFS,
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
  anthropic: {
    apiKey: parsedEnv.ANTHROPIC_API_KEY,
    model: parsedEnv.ANTHROPIC_MODEL,
  },
  scanEnhanceUrl: parsedEnv.SCAN_ENHANCE_URL,
  checklistFileMaxBytes: parsedEnv.CHECKLIST_FILE_MAX_BYTES,
  geoip: {
    enabled: parsedEnv.GEOIP_ENABLED,
    apiUrl: parsedEnv.GEOIP_API_URL,
  },
  internalApiToken: parsedEnv.INTERNAL_API_TOKEN,
  masterAdminCpfs: parsedEnv.MASTER_ADMIN_CPFS,
}
