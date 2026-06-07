import { ArrowRight } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import { formatDurationDays } from '@/shared/lib/format'
import type { StageTimingStats } from '../../services/dashboard.service'

type StageTimingsCardsProps = {
  timings: StageTimingStats['timings']
}

export function StageTimingsCards({ timings }: StageTimingsCardsProps) {
  const cards = [
    { title: 'Cadastro → Doc. pronta', timing: timings.cadToDoc },
    { title: 'Doc. pronta → Iniciado', timing: timings.docToStart },
    { title: 'Iniciado → Finalizado', timing: timings.startToFinal },
    { title: 'Cadastro → Finalizado', timing: timings.cadToFinal },
  ]

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="rise-in">
          <CardContent className="flex items-start gap-4 pt-6">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <ArrowRight className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                {card.title}
              </p>
              <p className="text-2xl font-semibold tracking-tight">
                {formatDurationDays(card.timing.avgDays)}
              </p>
              <p className="text-xs text-muted-foreground">
                {card.timing.count} processo(s)
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
