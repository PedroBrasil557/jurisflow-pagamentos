import { and, count, gte, lte, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { process } from '../processes/processes.schema'

type StageTiming = {
  avgDays: number | null
  count: number
}

// Media (em dias) da diferenca entre dois marcos, considerando apenas
// processos com ambos preenchidos.
function avgDaysBetween(start: string, end: string) {
  return sql<
    number | null
  >`avg(extract(epoch from (${sql.raw(end)} - ${sql.raw(start)})) / 86400)`
}

function countBetween(start: string, end: string) {
  return count(sql`case when ${sql.raw(start)} is not null and ${sql.raw(end)} is not null then 1 end`)
}

export async function getStageTimingStats(from: Date, to: Date) {
  const [row] = await db
    .select({
      cadToDocAvg: avgDaysBetween('created_at', 'documentation_ready_at'),
      cadToDocCount: countBetween('created_at', 'documentation_ready_at'),
      docToStartAvg: avgDaysBetween(
        'documentation_ready_at',
        'started_at',
      ),
      docToStartCount: countBetween('documentation_ready_at', 'started_at'),
      startToFinalAvg: avgDaysBetween('started_at', 'finalized_at'),
      startToFinalCount: countBetween('started_at', 'finalized_at'),
      cadToFinalAvg: avgDaysBetween('created_at', 'finalized_at'),
      cadToFinalCount: countBetween('created_at', 'finalized_at'),
    })
    .from(process)
    .where(and(gte(process.createdAt, from), lte(process.createdAt, to)))

  function build(avg: number | null, total: number): StageTiming {
    return {
      avgDays: total > 0 && avg !== null ? Math.round(avg * 100) / 100 : null,
      count: total,
    }
  }

  return {
    timings: {
      cadToDoc: build(row.cadToDocAvg, row.cadToDocCount),
      docToStart: build(row.docToStartAvg, row.docToStartCount),
      startToFinal: build(row.startToFinalAvg, row.startToFinalCount),
      cadToFinal: build(row.cadToFinalAvg, row.cadToFinalCount),
    },
  }
}
