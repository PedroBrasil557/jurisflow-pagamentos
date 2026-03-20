import { z } from 'zod'

const isProduction = import.meta.env.PROD

const clientEnvSchema = z.object({
  VITE_API_URL: z.url({
    message: 'VITE_API_URL precisa ser uma URL valida.',
  }),
})

const parsedClientEnv = clientEnvSchema.safeParse({
  VITE_API_URL:
    import.meta.env.VITE_API_URL ??
    (!isProduction ? 'http://localhost:3556' : undefined),
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
