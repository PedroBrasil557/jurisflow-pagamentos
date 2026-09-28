import { defineConfig } from 'drizzle-kit'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:3557/app'

export default defineConfig({
  schema: [
    './src/modules/ai-analysis/ai-analysis.schema.ts',
    './src/modules/auth/auth.schema.ts',
    './src/modules/auth-audit/auth-audit.schema.ts',
    './src/modules/finance/finance.schema.ts',
    './src/modules/housing-complexes/housing-complexes.schema.ts',
    './src/modules/processes/processes.schema.ts',
    './src/modules/permissions/permissions.schema.ts',
    './src/modules/settings/settings.schema.ts',
    './src/modules/quitacao-queue/quitacao-queue.schema.ts',
    './src/modules/titulares-caixa/titulares-caixa.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
