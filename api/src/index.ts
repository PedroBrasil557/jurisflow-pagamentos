import { createApp } from './app'
import { env } from './shared/config/env'

const app = createApp({
  allowedOrigins: env.trustedOrigins,
})
const hostname = env.host
const port = env.port

export default {
  fetch: app.fetch,
  hostname,
  port,
}
