import { inArray } from 'drizzle-orm'
import { reconcileProcessStatus } from '../src/modules/processes/processes.checklist.service'
import { process } from '../src/modules/processes/processes.schema'
import { db } from '../src/shared/db'

// Backfill one-off: reconcilia o status dos processos em EM_DOCUMENTACAO. Antes do
// fix, anexos de SISTEMA (worker de quitacao -> declaracao_quitacao) completavam a
// documentacao sem disparar o reconciliador, deixando processos completos travados
// em EM_DOCUMENTACAO. Aqui recomputamos: os que estiverem completos avancam para
// DOCUMENTACAO_PRONTA. Idempotente e seguro (so toca EM_DOCUMENTACAO).
const BOT = { id: 'jurisflow-bot' } as unknown as Parameters<
  typeof reconcileProcessStatus
>[1]

const rows = await db
  .select({ id: process.id, status: process.status })
  .from(process)
  // Inclui DOCUMENTACAO_PRONTA: reverte os que ficaram prontos indevidamente (sem
  // conjunto vinculado) para EM_DOCUMENTACAO.
  .where(inArray(process.status, ['EM_DOCUMENTACAO', 'DOCUMENTACAO_PRONTA']))

let advanced = 0
for (const row of rows) {
  const updated = await reconcileProcessStatus(row.id, BOT)
  if (updated.status !== row.status) {
    console.log(`${row.id}: ${row.status} -> ${updated.status}`)
    advanced++
  }
}
console.log(`Reconciliados ${rows.length} processo(s); ${advanced} avancaram.`)

await (
  globalThis as typeof globalThis & { __apiPool?: { end: () => Promise<void> } }
).__apiPool?.end()
