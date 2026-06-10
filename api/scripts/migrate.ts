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

// Mesma logica para a analise do contrato Caixa, mas SO para 'processing'
// obsoleto (> 10 min): em prod ha mais de uma instancia da API, e um boot
// (rolling deploy) nao pode resetar para 'error' um job que outra instancia
// acabou de iniciar. Jobs recem-orfaos sao recuperados pelo claim stale-aware.
const orphanedCaixa = await pool.query(
  `UPDATE process
   SET caixa_analysis_status = 'error'
   WHERE caixa_analysis_status = 'processing'
     AND updated_at < now() - interval '10 minutes'`,
)
if (orphanedCaixa.rowCount && orphanedCaixa.rowCount > 0) {
  console.log(`Reset ${orphanedCaixa.rowCount} analise(s) Caixa orfa(s).`)
}

// Consulta de quitacao (worker RPA): 'processing' restante no boot foi
// interrompido -> volta para 'pending' para ser reprocessado pelo worker.
const orphanedQuitacao = await pool.query(
  `UPDATE process
   SET caixa_quitacao_status = 'pending'
   WHERE caixa_quitacao_status = 'processing'`,
)
if (orphanedQuitacao.rowCount && orphanedQuitacao.rowCount > 0) {
  console.log(`Reset ${orphanedQuitacao.rowCount} consulta(s) de quitacao orfa(s).`)
}

await pool.end()
