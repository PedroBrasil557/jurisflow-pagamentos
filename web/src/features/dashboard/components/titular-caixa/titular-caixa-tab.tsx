import { useQuery } from '@tanstack/react-query'
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
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { QueryError } from '@/shared/components/query-error'
import { titularCaixaStatsOptions } from '../../services/dashboard.queries'
import type { TitularCaixaStats } from '../../services/dashboard.service'

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

function buildCards(data: TitularCaixaStats): {
  quitacao: KpiCard[]
  averbacao: KpiCard[]
} {
  const { quitacao, averbacao } = data
  return {
    quitacao: [
      {
        title: 'Total de titulares',
        value: data.total,
        subtitle: 'no cadastro',
        icon: Users,
        color: 'text-primary',
        bg: 'bg-primary/10',
      },
      {
        title: 'Quitados',
        value: quitacao.quitado,
        subtitle: `${data.termos} termos emitidos`,
        icon: CheckCircle,
        color: 'text-green-600 dark:text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        title: 'Pendentes',
        value: quitacao.idle + quitacao.pending,
        subtitle: `${quitacao.idle} sem consulta`,
        icon: Clock,
        color: 'text-blue-600 dark:text-blue-500',
        bg: 'bg-blue-500/10',
      },
      {
        title: 'Sem exito',
        value: quitacao.naoEncontrado + quitacao.erro,
        subtitle: `${quitacao.naoEncontrado} nao encontrados · ${quitacao.erro} erro`,
        icon: SearchX,
        color: 'text-amber-600 dark:text-amber-500',
        bg: 'bg-amber-500/10',
      },
    ],
    averbacao: [
      {
        title: 'Averbacao: sim',
        value: averbacao.sim,
        subtitle: 'termo apto a averbacao',
        icon: FileCheck,
        color: 'text-green-600 dark:text-green-500',
        bg: 'bg-green-500/10',
      },
      {
        title: 'Averbacao: nao',
        value: averbacao.nao,
        subtitle: 'termo nao apto a averbacao',
        icon: FileX,
        color: 'text-red-600 dark:text-red-500',
        bg: 'bg-red-500/10',
      },
      {
        title: 'Averbacao: indeterminado',
        value: averbacao.indeterminado,
        subtitle: 'requer revisao manual',
        icon: HelpCircle,
        color: 'text-amber-600 dark:text-amber-500',
        bg: 'bg-amber-500/10',
      },
      {
        title: 'Termos emitidos',
        value: data.termos,
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
    titularCaixaStatsOptions(),
  )

  if (isError) {
    return <QueryError onRetry={refetch} />
  }

  if (isLoading || !data) {
    return (
      <div className="grid gap-6">
        {['row-1', 'row-2'].map((row) => (
          <section
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            key={row}
          >
            {['a', 'b', 'c', 'd'].map((k) => (
              <Skeleton className="h-[120px] rounded-lg" key={`${row}-${k}`} />
            ))}
          </section>
        ))}
      </div>
    )
  }

  const cards = buildCards(data)

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Quitacao</h2>
        <KpiGrid cards={cards.quitacao} />
      </div>
      <div className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Averbacao</h2>
        <KpiGrid cards={cards.averbacao} />
      </div>
    </div>
  )
}
