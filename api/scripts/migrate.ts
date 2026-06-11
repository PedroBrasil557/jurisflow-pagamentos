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

// Reseta APENAS desmembramentos orfaos do fluxo LEGADO de batch-split (sem lease):
// esses rodam como promise detached na API e morrem no restart. A ingestao (fila
// worker+claim) tem split_lease_expires_at e e recuperada pelo PROPRIO worker
// (re-reivindica 'processing' com lease expirado) — NAO deve ser resetada aqui,
// senao um job vivo do worker (processo separado, sobrevive ao restart da API)
// viraria 'error' indevidamente.
const orphaned = await pool.query(
  `UPDATE process_batch_file
   SET split_status = 'error',
       split_message = 'O desmembramento foi interrompido. Tente novamente.',
       split_updated_at = now()
   WHERE split_status = 'processing'
     AND split_lease_expires_at IS NULL`,
)
if (orphaned.rowCount && orphaned.rowCount > 0) {
  console.log(`Reset ${orphaned.rowCount} desmembramento(s) orfao(s) (legado).`)
}

// Analise do contrato Caixa, SO para 'processing' obsoleto (heartbeat
// caixa_analysis_started_at > 10 min): em prod ha mais de uma instancia da API,
// e um boot (rolling deploy) nao pode resetar para 'error' um job que outra
// instancia acabou de iniciar. (O claim ja e stale-aware; o sweeper apenas
// antecipa a recuperacao para a UI.)
const orphanedCaixa = await pool.query(
  `UPDATE process
   SET caixa_analysis_status = 'error'
   WHERE caixa_analysis_status = 'processing'
     AND caixa_analysis_started_at < now() - interval '10 minutes'`,
)
if (orphanedCaixa.rowCount && orphanedCaixa.rowCount > 0) {
  console.log(`Reset ${orphanedCaixa.rowCount} analise(s) Caixa orfa(s).`)
}

// Analise da procuracao (conjunto a partir do endereco): 'processing' obsoleto
// (> 10 min) vira 'error' para recuperacao na UI. Mesma logica do caixa-owner.
const orphanedProcuracao = await pool.query(
  `UPDATE process
   SET procuracao_conjunto_status = 'error'
   WHERE procuracao_conjunto_status = 'processing'
     AND procuracao_conjunto_started_at < now() - interval '10 minutes'`,
)
if (orphanedProcuracao.rowCount && orphanedProcuracao.rowCount > 0) {
  console.log(
    `Reset ${orphanedProcuracao.rowCount} analise(s) de procuracao orfa(s).`,
  )
}

// Consulta de quitacao (worker RPA): 'processing' OBSOLETO (> 10 min) volta para
// 'pending' para ser reprocessado. Staleness pelo heartbeat, nao por updated_at.
const orphanedQuitacao = await pool.query(
  `UPDATE process
   SET caixa_quitacao_status = 'pending'
   WHERE caixa_quitacao_status = 'processing'
     AND caixa_quitacao_started_at < now() - interval '10 minutes'`,
)
if (orphanedQuitacao.rowCount && orphanedQuitacao.rowCount > 0) {
  console.log(`Reset ${orphanedQuitacao.rowCount} consulta(s) de quitacao orfa(s).`)
}

await pool.end()
