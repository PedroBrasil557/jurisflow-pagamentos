// Prova reproduzivel de que a migration 0038 NAO apaga dado financeiro: em um banco
// descartavel no estado 0037 com uma regra gravada, a 0038 precisa abortar e o dado
// precisa continuar la. Uso: bun run scripts/verify-0038-guard.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const base =
  process.env.TEST_DB_BASE ?? 'postgresql://postgres:postgres@localhost:3557'
const dbName = 'app_guard0038_test'

const admin = new pg.Pool({ connectionString: `${base}/postgres` })
await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
await admin.query(`CREATE DATABASE ${dbName}`)

// Pasta de migrations truncada ate a 0037.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig0037-'))
fs.cpSync('./drizzle', tmp, { recursive: true })
const journalPath = path.join(tmp, 'meta/_journal.json')
const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 37)
fs.writeFileSync(journalPath, JSON.stringify(journal))

const pool = new pg.Pool({ connectionString: `${base}/${dbName}` })
const db = drizzle(pool)
let exitCode = 0
try {
  await migrate(db, { migrationsFolder: tmp })
  await pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ('u1', 'Teste', 'u1@test.local')`,
  )
  await pool.query(
    `INSERT INTO finance_recipient (id, name, kind, created_by_user_id) VALUES ('r1', 'Ficticio', 'PESSOA_FISICA', 'u1')`,
  )
  await pool.query(
    `INSERT INTO finance_rule (id, recipient_id, role, valid_from, basis_points, cascade_order, created_by_user_id)
     VALUES ('rule1', 'r1', 'DISTRIBUICAO', '2026-01-01', 100, 1, 'u1')`,
  )

  let aborted = false
  try {
    await migrate(db, { migrationsFolder: './drizzle' })
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause
    aborted = /0038 abortada/.test(`${(error as Error).message} ${cause?.message}`)
  }
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM finance_rule')
  const applied = await pool.query(
    'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
  )
  console.log({ aborted, financeRuleRows: rows[0].n, migrations: applied.rows[0].n })
  if (!aborted || rows[0].n !== 1 || applied.rows[0].n !== 38) exitCode = 1
} finally {
  await pool.end()
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
  await admin.end()
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(exitCode === 0 ? 'OK: 0038 abortou e preservou os dados.' : 'FALHA')
process.exit(exitCode)
