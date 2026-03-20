import { count, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { user } from '../auth/auth.schema'
import { process } from '../processes/processes.schema'

const statusLabels: Record<string, string> = {
  EM_DOCUMENTACAO: 'Em documentacao',
  DOCUMENTACAO_PRONTA: 'Documentacao pronta',
  EM_PROCESSO: 'Em processo',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
}

const ownerTypeLabels: Record<string, string> = {
  primeiro_proprietario_uma_pessoa: '1 proprietario',
  primeiro_proprietario_casal: '1 proprietario (casal)',
  segundo_proprietario_uma_pessoa: '2 proprietario',
  segundo_proprietario_casal: '2 proprietario (casal)',
}

const monthNames = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

export async function getDashboardStats() {
  const [
    summaryRows,
    statusRows,
    ownerTypeRows,
    creatorRows,
    timelineRows,
    housingRows,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        emDocumentacao: count(
          sql`CASE WHEN ${process.status} = 'EM_DOCUMENTACAO' THEN 1 END`,
        ),
        documentacaoPronta: count(
          sql`CASE WHEN ${process.status} = 'DOCUMENTACAO_PRONTA' THEN 1 END`,
        ),
        emProcesso: count(
          sql`CASE WHEN ${process.status} = 'EM_PROCESSO' THEN 1 END`,
        ),
        finalizado: count(
          sql`CASE WHEN ${process.status} = 'FINALIZADO' THEN 1 END`,
        ),
        cancelado: count(
          sql`CASE WHEN ${process.status} = 'CANCELADO' THEN 1 END`,
        ),
      })
      .from(process),

    db
      .select({
        status: process.status,
        count: count(),
      })
      .from(process)
      .groupBy(process.status),

    db
      .select({
        ownerType: process.ownerType,
        count: count(),
      })
      .from(process)
      .groupBy(process.ownerType),

    db
      .select({
        userId: process.createdByUserId,
        userName: user.name,
        count: count(),
      })
      .from(process)
      .innerJoin(user, eq(process.createdByUserId, user.id))
      .groupBy(process.createdByUserId, user.name)
      .orderBy(sql`count(*) DESC`)
      .limit(10),

    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${process.createdAt}), 'YYYY-MM')`,
        count: count(),
      })
      .from(process)
      .where(
        sql`${process.createdAt} >= date_trunc('month', now() - interval '11 months')`,
      )
      .groupBy(sql`date_trunc('month', ${process.createdAt})`)
      .orderBy(sql`date_trunc('month', ${process.createdAt})`),

    db
      .select({
        housingComplex: process.housingComplex,
        count: count(),
      })
      .from(process)
      .where(sql`${process.housingComplex} != ''`)
      .groupBy(process.housingComplex)
      .orderBy(sql`count(*) DESC`)
      .limit(10),
  ])

  const s = summaryRows[0]
  const summary = {
    total: s.total,
    active: s.total - s.finalizado - s.cancelado,
    emDocumentacao: s.emDocumentacao,
    documentacaoPronta: s.documentacaoPronta,
    emProcesso: s.emProcesso,
    finalizado: s.finalizado,
    cancelado: s.cancelado,
  }

  const statusDistribution = statusRows.map((row) => ({
    status: row.status,
    label: statusLabels[row.status] ?? row.status,
    count: row.count,
  }))

  const ownerTypeDistribution = ownerTypeRows.map((row) => ({
    ownerType: row.ownerType,
    label: ownerTypeLabels[row.ownerType] ?? row.ownerType,
    count: row.count,
  }))

  const topCreators = creatorRows.map((row) => ({
    userId: row.userId,
    userName: row.userName,
    count: row.count,
  }))

  const timelineMap = new Map(timelineRows.map((row) => [row.month, row.count]))
  const creationTimeline: Array<{
    month: string
    label: string
    count: number
  }> = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${monthNames[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`
    creationTimeline.push({
      month: key,
      label,
      count: timelineMap.get(key) ?? 0,
    })
  }

  const topHousingComplexes = housingRows.map((row) => ({
    housingComplex: row.housingComplex,
    count: row.count,
  }))

  return {
    summary,
    statusDistribution,
    ownerTypeDistribution,
    topCreators,
    creationTimeline,
    topHousingComplexes,
  }
}
