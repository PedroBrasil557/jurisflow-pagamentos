import { createApp } from './src/app'
import { env } from './src/shared/config/env'

// A entrada local em src/index.ts continua sendo usada pelo Bun.
// Na Vercel, cada requisição é atendida por uma Function.
const app = createApp({ allowedOrigins: env.trustedOrigins })

export default app
