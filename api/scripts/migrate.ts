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

// ALTER TYPE ADD VALUE cannot run inside a transaction.
// Run enum updates first in autocommit mode before Drizzle migrations.
const enumStatements = [
  "ALTER TYPE \"public\".\"process_history_event_type\" ADD VALUE IF NOT EXISTS 'BATCH_UPLOADED'",
  "ALTER TYPE \"public\".\"process_history_event_type\" ADD VALUE IF NOT EXISTS 'BATCH_DELETED'",
  "ALTER TYPE \"public\".\"process_status\" ADD VALUE IF NOT EXISTS 'CADASTRADO' BEFORE 'EM_DOCUMENTACAO'",
  "ALTER TYPE \"public\".\"process_status\" ADD VALUE IF NOT EXISTS 'EM_LOTE' BEFORE 'EM_DOCUMENTACAO'",
]

console.log('Applying enum updates...')

for (const stmt of enumStatements) {
  try {
    await pool.query(stmt)
  } catch (error) {
    // Ignore if enum value already exists
    const message = error instanceof Error ? error.message : String(error)

    if (!message.includes('already exists')) {
      throw error
    }
  }
}

console.log('Running migrations...')
const db = drizzle(pool)
await migrate(db, { migrationsFolder: './drizzle' })
console.log('Migrations complete.')

await pool.end()
