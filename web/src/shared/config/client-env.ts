import { z } from 'zod'

const isProduction = import.meta.env.PROD

function getDefaultApiUrl() {
  if (isProduction && typeof window !== 'undefined') {
    return window.location.origin
  }

  return import.meta.env.VITE_API_URL ?? 'http://localhost:3555'
}

const clientEnvSchema = z.object({
  VITE_API_URL: z
    .string()
    .trim()
    .transform((value, context) => {
      try {
        return new URL(value).origin
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'VITE_API_URL precisa ser uma URL valida.',
        })

        return z.NEVER
      }
    }),
})

const parsedClientEnv = clientEnvSchema.safeParse({
  VITE_API_URL: getDefaultApiUrl(),
})

if (!parsedClientEnv.success) {
  const issues = parsedClientEnv.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join(', ')

  throw new Error(`Invalid client environment variables: ${issues}`)
}

export const clientEnv = {
  apiUrl: parsedClientEnv.data.VITE_API_URL,
}
