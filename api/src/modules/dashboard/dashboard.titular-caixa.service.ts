import { count, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  titularContratoCaixa,
  titularDocumento,
} from '../titulares-caixa/titulares-caixa.schema'

// Indicadores de Titular Caixa para o dashboard (admin-only). Agrega a projecao de
// quitacao e o flag de averbacao da tabela de negocio + a contagem de termos.
export async function getTitularCaixaStats() {
  const [[summary], [termosRow]] = await Promise.all([
    db
      .select({
        total: count(),
        idle: count(
          sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'idle' THEN 1 END`,
        ),
        pending: count(
          sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'pending' THEN 1 END`,
        ),
        quitado: count(
          sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'quitado' THEN 1 END`,
        ),
        naoEncontrado: count(
          sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'nao_encontrado' THEN 1 END`,
        ),
        erro: count(
          sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'erro' THEN 1 END`,
        ),
        averbacaoSim: count(
          sql`CASE WHEN ${titularContratoCaixa.averbacao} = 'sim' THEN 1 END`,
        ),
        averbacaoNao: count(
          sql`CASE WHEN ${titularContratoCaixa.averbacao} = 'nao' THEN 1 END`,
        ),
        averbacaoIndeterminado: count(
          sql`CASE WHEN ${titularContratoCaixa.averbacao} = 'indeterminado' THEN 1 END`,
        ),
      })
      .from(titularContratoCaixa),
    db.select({ termos: count() }).from(titularDocumento),
  ])

  return {
    total: summary?.total ?? 0,
    quitacao: {
      idle: summary?.idle ?? 0,
      pending: summary?.pending ?? 0,
      quitado: summary?.quitado ?? 0,
      naoEncontrado: summary?.naoEncontrado ?? 0,
      erro: summary?.erro ?? 0,
    },
    averbacao: {
      sim: summary?.averbacaoSim ?? 0,
      nao: summary?.averbacaoNao ?? 0,
      indeterminado: summary?.averbacaoIndeterminado ?? 0,
    },
    termos: termosRow?.termos ?? 0,
  }
}
