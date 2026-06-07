import { CheckCircle, FilePlus2, FileSearch, Gavel } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import type { ProductivityStats } from '../../services/dashboard.service'

type ProductivityKpisProps = {
  totals: ProductivityStats['totals']
}

export function ProductivityKpis({ totals }: ProductivityKpisProps) {
  const cards = [
    {
      title: 'Processos criados',
      value: totals.criados,
      icon: FilePlus2,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      title: 'Documentacao pronta',
      value: totals.docPronta,
      icon: FileSearch,
      color: 'text-amber-600 dark:text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      title: 'Iniciados',
      value: totals.iniciados,
      icon: Gavel,
      color: 'text-purple-600 dark:text-purple-500',
      bg: 'bg-purple-500/10',
    },
    {
      title: 'Finalizados',
      value: totals.finalizados,
      icon: CheckCircle,
      color: 'text-green-600 dark:text-green-500',
      bg: 'bg-green-500/10',
    },
  ]

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
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
