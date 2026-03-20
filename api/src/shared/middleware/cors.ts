import { cors } from 'hono/cors'

export function createCorsMiddleware(allowedOrigins: string[]) {
  const allowedOriginSet = new Set(allowedOrigins)

  return cors({
    origin: (origin) => {
      if (!origin) {
        return null
      }

      return allowedOriginSet.has(origin) ? origin : null
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  })
}
