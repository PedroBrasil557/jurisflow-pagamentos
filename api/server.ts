import { createApp } from './src/app'
import { env } from './src/shared/config/env'

// A entrada local em src/index.ts continua sendo usada pelo Bun.
// Na Vercel, nenhum valor de desenvolvimento pode servir como segredo real.
if (process.env.VERCEL) {
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_SECRET']) {
    if (!process.env[key]) {
      throw new Error(`Configuração obrigatória ausente: ${key}`)
    }
  }
}

const app = createApp({ allowedOrigins: env.trustedOrigins })

export default app
