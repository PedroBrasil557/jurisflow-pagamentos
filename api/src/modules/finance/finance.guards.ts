import { eq } from 'drizzle-orm'
import { db } from '../../shared/db'
import { financeReceipt, financeReserveMovement } from './finance.schema'

/**
 * Processo tem QUALQUER registro financeiro (inclusive cancelado)? Usado para
 * impedir a exclusao do processo. Linhas de fechamento sempre derivam de um
 * recebimento, entao recebimento + livro de reservas cobrem tudo.
 */
export async function processHasFinanceRecords(
  processId: string,
): Promise<boolean> {
  const [receipt] = await db
    .select({ id: financeReceipt.id })
    .from(financeReceipt)
    .where(eq(financeReceipt.processId, processId))
    .limit(1)
  if (receipt) return true

  const [movement] = await db
    .select({ id: financeReserveMovement.id })
    .from(financeReserveMovement)
    .where(eq(financeReserveMovement.processId, processId))
    .limit(1)
  return Boolean(movement)
}
