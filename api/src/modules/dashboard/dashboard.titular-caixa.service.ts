import { count, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  titularContratoCaixa,
  titularDocumento,
} from '../titulares-caixa/titulares-caixa.schema'

// TEMPORARIO: o dashboard de Titular Caixa mostra apenas a Bahia por enquanto.
// Remover quando a permissao por estado for implementada (ai o recorte de UF passa
// a vir dos estados permitidos do usuario, nao de uma constante).
const DASHBOARD_UF_TEMPORARIA = 'BA'

type LocalIndicadores = {
  total: number
  quitado: number
  pendente: number
  // idle e a parcela "sem consulta" dentro de pendente (pendente = idle + pending).
  idle: number
  semExito: number
  // semExito = naoEncontrado + erro; guardamos a quebra p/ os subtitulos dos KPI.
  naoEncontrado: number
  erro: number
  // Termos de quitacao emitidos (join em titularDocumento por titularId).
  termos: number
  averbacao: { sim: number; nao: number; indeterminado: number }
}

type EmpreendimentoStats = {
  empreendimento: string
  logradouro: string | null
  indicadores: LocalIndicadores
}

type MunicipioStats = {
  uf: string
  municipio: string
  indicadores: LocalIndicadores
  empreendimentos: EmpreendimentoStats[]
}

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

function somaIndicadores(alvo: LocalIndicadores, origem: LocalIndicadores) {
  alvo.total += origem.total
  alvo.quitado += origem.quitado
  alvo.pendente += origem.pendente
  alvo.idle += origem.idle
  alvo.semExito += origem.semExito
  alvo.naoEncontrado += origem.naoEncontrado
  alvo.erro += origem.erro
  alvo.termos += origem.termos
  alvo.averbacao.sim += origem.averbacao.sim
  alvo.averbacao.nao += origem.averbacao.nao
  alvo.averbacao.indeterminado += origem.averbacao.indeterminado
}

function porTotalDesc(
  a: { indicadores: LocalIndicadores },
  b: { indicadores: LocalIndicadores },
  nomeA: string,
  nomeB: string,
) {
  if (b.indicadores.total !== a.indicadores.total) {
    return b.indicadores.total - a.indicadores.total
  }
  return nomeA.localeCompare(nomeB, 'pt-BR')
}

// Indicadores agrupados por municipio e empreendimento/logradouro. Uma unica
// query com GROUP BY na granularidade mais fina; a linha do municipio e a soma
// dos empreendimentos dele. Pendente = idle + pending; sem exito =
// nao_encontrado + erro (mesma semantica dos KPI cards globais).
export async function getTitularCaixaStatsPorLocal(): Promise<{
  municipios: MunicipioStats[]
}> {
  const rows = await db
    .select({
      uf: titularContratoCaixa.uf,
      municipio: titularContratoCaixa.municipio,
      empreendimento: titularContratoCaixa.empreendimento,
      logradouro: titularContratoCaixa.logradouro,
      // O left join em titularDocumento e 1:0/1:1 (indice unico titular+tipo, unico
      // tipo = termo_quitacao), entao nao multiplica a contagem de titulares.
      total: count(titularContratoCaixa.id),
      quitado: count(
        sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'quitado' THEN 1 END`,
      ),
      pendente: count(
        sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} IN ('idle', 'pending') THEN 1 END`,
      ),
      idle: count(
        sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'idle' THEN 1 END`,
      ),
      semExito: count(
        sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} IN ('nao_encontrado', 'erro') THEN 1 END`,
      ),
      naoEncontrado: count(
        sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'nao_encontrado' THEN 1 END`,
      ),
      erro: count(
        sql`CASE WHEN ${titularContratoCaixa.quitacaoStatus} = 'erro' THEN 1 END`,
      ),
      termos: count(titularDocumento.id),
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
    .from(titularContratoCaixa)
    .leftJoin(
      titularDocumento,
      eq(titularDocumento.titularId, titularContratoCaixa.id),
    )
    // TEMPORARIO: restringe o dashboard a uma unica UF ate a permissao por estado.
    .where(eq(titularContratoCaixa.uf, DASHBOARD_UF_TEMPORARIA))
    .groupBy(
      titularContratoCaixa.uf,
      titularContratoCaixa.municipio,
      titularContratoCaixa.empreendimento,
      titularContratoCaixa.logradouro,
    )

  const porMunicipio = new Map<string, MunicipioStats>()

  for (const row of rows) {
    const chave = `${row.uf}|${row.municipio}`
    let municipio = porMunicipio.get(chave)
    if (!municipio) {
      municipio = {
        uf: row.uf,
        municipio: row.municipio,
        indicadores: {
          total: 0,
          quitado: 0,
          pendente: 0,
          idle: 0,
          semExito: 0,
          naoEncontrado: 0,
          erro: 0,
          termos: 0,
          averbacao: { sim: 0, nao: 0, indeterminado: 0 },
        },
        empreendimentos: [],
      }
      porMunicipio.set(chave, municipio)
    }

    const indicadores: LocalIndicadores = {
      total: row.total,
      quitado: row.quitado,
      pendente: row.pendente,
      idle: row.idle,
      semExito: row.semExito,
      naoEncontrado: row.naoEncontrado,
      erro: row.erro,
      termos: row.termos,
      averbacao: {
        sim: row.averbacaoSim,
        nao: row.averbacaoNao,
        indeterminado: row.averbacaoIndeterminado,
      },
    }

    municipio.empreendimentos.push({
      empreendimento: row.empreendimento,
      logradouro: row.logradouro,
      indicadores,
    })
    somaIndicadores(municipio.indicadores, indicadores)
  }

  const municipios = [...porMunicipio.values()].sort((a, b) =>
    porTotalDesc(a, b, a.municipio, b.municipio),
  )
  for (const municipio of municipios) {
    municipio.empreendimentos.sort((a, b) =>
      porTotalDesc(a, b, a.empreendimento, b.empreendimento),
    )
  }

  return { municipios }
}
