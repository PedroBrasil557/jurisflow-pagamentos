import { and, count, eq, gte, lte } from 'drizzle-orm'
import { db } from '../../shared/db'
import { user } from '../auth/auth.schema'
import { processHistory } from '../processes/processes.schema'

type ProductivityUserRow = {
  userId: string
  userName: string
  criados: number
  docPronta: number
  iniciados: number
  finalizados: number
  total: number
}

function emptyRow(userId: string, userName: string): ProductivityUserRow {
  return {
    userId,
    userName,
    criados: 0,
    docPronta: 0,
    iniciados: 0,
    finalizados: 0,
    total: 0,
  }
}

/**
 * Agrega a tabela de auditoria (processHistory) por usuário no período
 * informado, produzindo indicadores de produção por pessoa.
 */
export async function getProductivityStats(from: Date, to: Date) {
  const rows = await db
    .select({
      userId: processHistory.actorUserId,
      userName: user.name,
      eventType: processHistory.eventType,
      toStatus: processHistory.toStatus,
      count: count(),
    })
    .from(processHistory)
    .innerJoin(user, eq(processHistory.actorUserId, user.id))
    .where(
      and(
        gte(processHistory.createdAt, from),
        lte(processHistory.createdAt, to),
      ),
    )
    .groupBy(
      processHistory.actorUserId,
      user.name,
      processHistory.eventType,
      processHistory.toStatus,
    )

  const byUser = new Map<string, ProductivityUserRow>()

  for (const row of rows) {
    const current = byUser.get(row.userId) ?? emptyRow(row.userId, row.userName)

    if (row.eventType === 'CREATED') {
      current.criados += row.count
    } else if (row.eventType === 'STATUS_CHANGED') {
      if (row.toStatus === 'DOCUMENTACAO_PRONTA') {
        current.docPronta += row.count
      } else if (row.toStatus === 'EM_PROCESSO') {
        current.iniciados += row.count
      } else if (row.toStatus === 'FINALIZADO') {
        current.finalizados += row.count
      }
    }

    byUser.set(row.userId, current)
  }

  const perUser = [...byUser.values()]
    .map((item) => ({
      ...item,
      total: item.criados + item.docPronta + item.iniciados + item.finalizados,
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)

  const totals = perUser.reduce(
    (acc, item) => ({
      criados: acc.criados + item.criados,
      docPronta: acc.docPronta + item.docPronta,
      iniciados: acc.iniciados + item.iniciados,
      finalizados: acc.finalizados + item.finalizados,
    }),
    { criados: 0, docPronta: 0, iniciados: 0, finalizados: 0 },
  )

  return { totals, perUser }
}
