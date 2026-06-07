import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:3557/app'

const isProduction = process.env.ENVIRONMENT === 'prod' || process.env.ENVIRONMENT === 'dev'

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...(isProduction ? { ssl: { rejectUnauthorized: false } } : {}),
})

console.log('Running database migrations...')
const db = drizzle(pool)
await migrate(db, { migrationsFolder: './drizzle' })
console.log('Migrations complete.')

// Reseta desmembramentos orfaos: no boot nenhum job esta rodando, entao qualquer
// 'processing' restante foi interrompido por um restart/crash. Sem isso, o arquivo
// ficaria travado (guard de idempotencia) e o front faria polling indefinidamente.
const orphaned = await pool.query(
  `UPDATE process_batch_file
   SET split_status = 'error',
       split_message = 'O desmembramento foi interrompido. Tente novamente.',
       split_updated_at = now()
   WHERE split_status = 'processing'`,
)
if (orphaned.rowCount && orphaned.rowCount > 0) {
  console.log(`Reset ${orphaned.rowCount} desmembramento(s) orfao(s).`)
}

await pool.end()
