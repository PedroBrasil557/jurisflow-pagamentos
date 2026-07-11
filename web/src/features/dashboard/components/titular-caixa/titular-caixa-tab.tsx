import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  CheckCircle,
  Clock,
  FileCheck,
  FileText,
  FileX,
  HelpCircle,
  SearchX,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { Card, CardContent } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { QueryError } from '@/shared/components/query-error'
import { titularCaixaStatsPorLocalOptions } from '../../services/dashboard.queries'
import type { TitularCaixaStatsPorLocal } from '../../services/dashboard.service'
import {
  type TitularCaixaScope,
  TitularCaixaScopeFilter,
} from './titular-caixa-scope-filter'
import { TitularesPorLocalSection } from './titulares-por-local-section'

type Municipios = TitularCaixaStatsPorLocal['municipios']
type Indicadores = Municipios[number]['indicadores']

type KpiCard = {
  title: string
  value: number
  subtitle: string
  icon: LucideIcon
  color: string
  bg: string
}

function KpiGrid({ cards }: { cards: KpiCard[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="rise-in">
          <CardContent className="flex items-start gap-4 pt-6">
            <div className={`rounded-lg p-2.5 ${card.bg}`}>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                {card.title}
              </p>
              <p className="text-2xl font-semibold tracking-tight">
                {card.value}
              </p>
              <p className="text-xs text-muted-foreground">{card.subtitle}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

function emptyIndicadores(): Indicadores {
  return {
    total: 0,
    quitado: 0,
    pendente: 0,
    idle: 0,
    semExito: 0,
    naoEncontrado: 0,
    erro: 0,
    termos: 0,
    averbacao: { sim: 0, nao: 0, indeterminado: 0 },
  }
}

// Acumula indicadores (mutando o alvo) — base do re-somatorio quando o escopo
// filtra empreendimentos (recorte por conjunto).
function addIndicadores(acc: Indicadores, i: Indicadores) {
  acc.total += i.total
  acc.quitado += i.quitado
  acc.pendente += i.pendente
  acc.idle += i.idle
  acc.semExito += i.semExito
  acc.naoEncontrado += i.naoEncontrado
  acc.erro += i.erro
  acc.termos += i.termos
  acc.averbacao.sim += i.averbacao.sim
  acc.averbacao.nao += i.averbacao.nao
  acc.averbacao.indeterminado += i.averbacao.indeterminado
}

// Soma os indicadores dos municipios do escopo — a fonte unica dos KPIs. Como a
// query "por local" ja quebra tudo por municipio, os cards batem exatamente com a
// soma exibida na secao de baixo em qualquer recorte.
function sumIndicadores(municipios: Municipios): Indicadores {
  return municipios.reduce((acc, municipio) => {
    addIndicadores(acc, municipio.indicadores)
    return acc
  }, emptyIndicadores())
}

// Aplica o escopo: UF/municipio no nivel do municipio; conjunto no nivel do
// empreendimento (filtra os empreendimentos do conjunto e RE-SOMA o indicador do
// municipio a partir deles, para os KPIs baterem com a tabela). Municipio sem
// nenhum empreendimento no conjunto e descartado.
function filterByScope(
  municipios: Municipios,
  scope: TitularCaixaScope,
): Municipios {
  const result: Municipios = []
  for (const m of municipios) {
    if (
      scope.municipio &&
      !(m.uf === scope.uf && m.municipio === scope.municipio)
    ) {
      continue
    }
    if (scope.uf && m.uf !== scope.uf) {
      continue
    }
    if (!scope.conjuntoId) {
      result.push(m)
      continue
    }
    const empreendimentos = m.empreendimentos.filter(
      (e) => e.conjuntoId === scope.conjuntoId,
    )
    if (empreendimentos.length === 0) {
      continue
    }
    const indicadores = emptyIndicadores()
    for (const e of empreendimentos) {
      addIndicadores(indicadores, e.indicadores)
    }
    result.push({ ...m, empreendimentos, indicadores })
  }
  return result
}

function buildCards(totals: Indicadores): {
  quitacao: KpiCard[]
  averbacao: KpiCard[]
} {
  return {
    quitacao: [
      {
        title: 'Total de titulares',
        value: totals.total,
        subtitle: 'no cadastro',
        icon: Users,
        color: 'text-primary',
        bg: 'bg-primary/10',
      },
      {
        title: 'Quitados',
        value: totals.quitado,
        subtitle: `${totals.termos} termos emitidos`,
        icon: CheckCircle,
        color: 'text-green-600 dark:text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        title: 'Pendentes',
        value: totals.pendente,
        subtitle: `${totals.idle} sem consulta`,
        icon: Clock,
        color: 'text-blue-600 dark:text-blue-500',
        bg: 'bg-blue-500/10',
      },
      {
        title: 'Sem exito',
        value: totals.semExito,
        subtitle: `${totals.naoEncontrado} nao encontrados · ${totals.erro} erro`,
        icon: SearchX,
        color: 'text-amber-600 dark:text-amber-500',
        bg: 'bg-amber-500/10',
      },
    ],
    averbacao: [
      {
        title: 'Averbacao: sim',
        value: totals.averbacao.sim,
        subtitle: 'termo apto a averbacao',
        icon: FileCheck,
        color: 'text-green-600 dark:text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        title: 'Averbacao: nao',
        value: totals.averbacao.nao,
        subtitle: 'termo nao apto a averbacao',
        icon: FileX,
        color: 'text-red-600 dark:text-red-500',
        bg: 'bg-red-500/10',
      },
      {
        title: 'Averbacao: indeterminado',
        value: totals.averbacao.indeterminado,
        subtitle: 'requer revisao manual',
        icon: HelpCircle,
        color: 'text-amber-600 dark:text-amber-500',
        bg: 'bg-amber-500/10',
      },
      {
        title: 'Termos emitidos',
        value: totals.termos,
        subtitle: 'declaracoes de quitacao',
        icon: FileText,
        color: 'text-primary',
        bg: 'bg-primary/10',
      },
    ],
  }
}

export function TitularCaixaTab() {
  const { data, isLoading, isError, refetch } = useQuery(
    titularCaixaStatsPorLocalOptions(),
  )
  const [scope, setScope] = useState<TitularCaixaScope>({
    uf: null,
    municipio: null,
    conjuntoId: null,
  })

  if (isError) {
    return <QueryError onRetry={refetch} />
  }

  if (isLoading || !data) {
    return <TitularCaixaTabSkeleton />
  }

  const { municipios } = data
  const ufs = [...new Set(municipios.map((m) => m.uf))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )
  const municipioOptions = municipios
    .filter((m) => (scope.uf ? m.uf === scope.uf : true))
    .map((m) => ({ uf: m.uf, municipio: m.municipio }))
    .sort((a, b) => a.municipio.localeCompare(b.municipio, 'pt-BR'))

  // Opcoes de conjunto do recorte geografico atual (UF/municipio, sem o filtro de
  // conjunto) — evita oferecer conjunto que ficaria vazio no recorte escolhido.
  const geoScoped = filterByScope(municipios, {
    uf: scope.uf,
    municipio: scope.municipio,
    conjuntoId: null,
  })
  const conjuntoMap = new Map<string, string>()
  for (const m of geoScoped) {
    for (const e of m.empreendimentos) {
      if (e.conjuntoId && e.conjuntoNome) {
        conjuntoMap.set(e.conjuntoId, e.conjuntoNome)
      }
    }
  }
  const conjuntoOptions = [...conjuntoMap.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  const filtered = filterByScope(municipios, scope)
  const cards = buildCards(sumIndicadores(filtered))

  return (
    <div className="grid gap-6">
      <TitularCaixaScopeFilter
        conjuntos={conjuntoOptions}
        municipios={municipioOptions}
        onChange={setScope}
        scope={scope}
        ufs={ufs}
      />

      <div className="grid gap-6">
        <div className="grid gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Quitacao
          </h2>
          <KpiGrid cards={cards.quitacao} />
        </div>
        <div className="grid gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Averbacao
          </h2>
          <KpiGrid cards={cards.averbacao} />
        </div>
      </div>

      <TitularesPorLocalSection municipios={filtered} scope={scope} />
    </div>
  )
}

function TitularCaixaTabSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-9 w-full max-w-md rounded-lg" />
      {['row-1', 'row-2'].map((row) => (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" key={row}>
          {['a', 'b', 'c', 'd'].map((k) => (
            <Skeleton className="h-[120px] rounded-lg" key={`${row}-${k}`} />
          ))}
        </section>
      ))}
      <Skeleton className="h-[300px] rounded-lg" />
      <Skeleton className="h-[240px] rounded-lg" />
    </div>
  )
}
