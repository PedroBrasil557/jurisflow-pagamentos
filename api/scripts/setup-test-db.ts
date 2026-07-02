import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

// Cria e migra um banco de teste ISOLADO (app_test) na mesma instancia Postgres do
// dev. O ingestion-worker so consome o banco 'app', entao 'app_test' nao tem worker
// competindo — claims deterministicos nos testes de integracao da fila.

const base =
  process.env.TEST_DB_BASE ?? 'postgresql://postgres:postgres@localhost:3557'
const dbName = process.env.TEST_DB_NAME ?? 'app_test'

const admin = new pg.Pool({ connectionString: `${base}/postgres` })
const exists = await admin.query(
  'SELECT 1 FROM pg_database WHERE datname = $1',
  [dbName],
)
if (exists.rowCount === 0) {
  // dbName e controlado (env/default), nao entrada de usuario.
  await admin.query(`CREATE DATABASE ${dbName}`)
  console.log(`Banco de teste criado: ${dbName}`)
} else {
  console.log(`Banco de teste ja existe: ${dbName}`)
}
await admin.end()

const pool = new pg.Pool({ connectionString: `${base}/${dbName}` })
const db = drizzle(pool)
console.log('Migrando o banco de teste...')
await migrate(db, { migrationsFolder: './drizzle' })
await pool.end()
console.log('Banco de teste pronto.')
