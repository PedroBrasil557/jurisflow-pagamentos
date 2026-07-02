import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import * as schema from './schema'

const globalForDatabase = globalThis as typeof globalThis & {
  __apiPool?: Pool
}

// Limite de conexoes do pool. Em processos worker (multi-replica) manter baixo para
// nao exaurir o max_connections do RDS ao escalar. Vazio = padrao do pg (10).
const poolMax = Number(process.env.DB_POOL_MAX) || undefined

function createPool(): Pool {
  const created = new Pool({
    connectionString: env.databaseUrl,
    ssl: process.env.ENVIRONMENT ? { rejectUnauthorized: false } : false,
    max: poolMax,
  })

  // Sem este handler, um erro em conexao OCIOSA (ex.: Postgres reinicia, conexao
  // dropada) emite 'error' NAO-tratado no EventEmitter e DERRUBA o processo — fatal
  // para um worker. Aqui apenas logamos: o pg descarta o cliente ruim e o proximo
  // query reconecta. (Anexado so na criacao, para nao vazar listeners no --hot.)
  created.on('error', (error) => {
    console.error('pg pool: erro em conexao ociosa (recuperavel)', {
      error: String(error),
    })
  })

  return created
}

const pool = globalForDatabase.__apiPool ?? createPool()

if (process.env.NODE_ENV !== 'production') {
  globalForDatabase.__apiPool = pool
}

export const db = drizzle(pool, { schema })

// Fecha o pool de forma limpa — graceful shutdown de processos worker/scripts.
export async function closeDb(): Promise<void> {
  await pool.end()
}
