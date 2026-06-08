import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { username } from 'better-auth/plugins'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'
import { loginAuditHook, signUpValidationHook } from './auth.hooks'
import { defaultUserRole } from './auth.roles'
import * as schema from './auth.schema'

const isProduction = !!process.env.ENVIRONMENT

export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: env.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
    ...(isProduction
      ? {
          defaultCookieAttributes: {
            sameSite: 'lax' as const,
            secure: true,
          },
        }
      : {}),
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
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
    after: loginAuditHook,
  },
})
