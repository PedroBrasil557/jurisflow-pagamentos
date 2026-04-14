import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { username } from 'better-auth/plugins'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'
import { signUpValidationHook } from './auth.hooks'
import { defaultUserRole } from './auth.roles'
import * as schema from './auth.schema'

const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, dkLen: 64 } as const
const SCRYPT_MAXMEM = 128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r * 2

export function hashPasswordSync(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = scryptSync(
    password.normalize('NFKC'),
    salt,
    SCRYPT_PARAMS.dkLen,
    {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_MAXMEM,
    },
  )
  return Promise.resolve(`${salt.toString('hex')}:${key.toString('hex')}`)
}

function verifyPasswordSync({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':')
  if (!saltHex || !keyHex) return Promise.resolve(false)

  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_MAXMEM,
  })

  if (actual.length !== expected.length) {
    return Promise.resolve(false)
  }

  return Promise.resolve(timingSafeEqual(actual, expected))
}

const isProduction = !!process.env.ENVIRONMENT

export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: env.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  advanced: isProduction
    ? {
        defaultCookieAttributes: {
          sameSite: 'lax',
          secure: true,
        },
      }
    : undefined,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    password: {
      hash: hashPasswordSync,
      verify: verifyPasswordSync,
    },
  },
  plugins: [
    username({
      minUsernameLength: 11,
      maxUsernameLength: 14,
      usernameValidator: (value) => {
        const normalized = normalizeCpf(String(value))
        return isValidCpf(normalized)
      },
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        input: false,
        defaultValue: defaultUserRole,
        sortable: true,
      },
      mustChangePassword: {
        type: 'boolean',
        required: true,
        input: false,
        defaultValue: false,
      },
      isActive: {
        type: 'boolean',
        required: true,
        input: false,
        defaultValue: true,
      },
    },
  },
  hooks: {
    before: signUpValidationHook,
  },
})
