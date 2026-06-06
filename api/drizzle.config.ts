import { defineConfig } from 'drizzle-kit'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:3557/app'

export default defineConfig({
  schema: [
    './src/modules/auth/auth.schema.ts',
    './src/modules/housing-complexes/housing-complexes.schema.ts',
    './src/modules/processes/processes.schema.ts',
    './src/modules/permissions/permissions.schema.ts',
    './src/modules/settings/settings.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
