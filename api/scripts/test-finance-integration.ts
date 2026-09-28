// Integracao do modulo Pagamentos em banco ISOLADO (padrao app_pagamentos_test).
// Portavel (PowerShell/bash): prepara/migra o banco de teste e roda os testes do
// modulo com RUN_INTEGRATION=1. Nunca aponta para o banco `app` com seed.
//   bun run test:integration:finance
const base =
  process.env.TEST_DB_BASE ?? 'postgresql://postgres:postgres@localhost:3557'
const dbName = process.env.TEST_DB_NAME ?? 'app_pagamentos_test'

if (!dbName.endsWith('_test')) {
  throw new Error(`Banco de teste deve terminar com _test (recebido: ${dbName}).`)
}

const env = { ...process.env, TEST_DB_BASE: base, TEST_DB_NAME: dbName }

const setup = Bun.spawnSync(['bun', 'run', 'scripts/setup-test-db.ts'], {
  env,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (setup.exitCode !== 0) process.exit(setup.exitCode ?? 1)

const tests = Bun.spawnSync(['bun', 'test', 'src/modules/finance'], {
  env: {
    ...env,
    RUN_INTEGRATION: '1',
    DATABASE_URL: `${base}/${dbName}`,
  },
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(tests.exitCode ?? 1)
