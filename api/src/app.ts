import { createAppRouter } from './routes'

type CreateAppOptions = {
  allowedOrigins: string[]
}

export function createApp(options: CreateAppOptions) {
  return createAppRouter(options)
}

export type AppType = ReturnType<typeof createApp>
