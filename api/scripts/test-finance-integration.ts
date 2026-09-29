// Integracao do modulo Pagamentos em banco ISOLADO e DESCARTAVEL (padrao
// app_pagamentos_test). Portavel (PowerShell/bash): recria o banco (registros
// financeiros sao indeleveis por design), aplica TODAS as migrations do zero e roda
// os testes do modulo com RUN_INTEGRATION=1. Nunca aponta para o banco `app`.
//   bun run test:integration:finance
import pg from 'pg'

const base =
  process.env.TEST_DB_BASE ?? 'postgresql://postgres:postgres@localhost:3557'
const dbName = process.env.TEST_DB_NAME ?? 'app_pagamentos_test'

if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  throw new Error(`Banco de teste deve terminar com _test (recebido: ${dbName}).`)
}

const admin = new pg.Pool({ connectionString: `${base}/postgres` })
await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
await admin.end()
console.log(`Banco de teste recriado: ${dbName}`)

const env = { ...process.env, TEST_DB_BASE: base, TEST_DB_NAME: dbName }

const setup = Bun.spawnSync(['bun', 'run', 'scripts/setup-test-db.ts'], {
  env,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (setup.exitCode !== 0) process.exit(setup.exitCode ?? 1)

const tests = Bun.spawnSync(
  ['bun', 'test', '--timeout', '30000', 'src/modules/finance'],
  {
    env: {
      ...env,
      RUN_INTEGRATION: '1',
      DATABASE_URL: `${base}/${dbName}`,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
process.exit(tests.exitCode ?? 1)
