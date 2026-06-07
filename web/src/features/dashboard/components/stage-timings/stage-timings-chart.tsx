import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import type { StageTimingStats } from '../../services/dashboard.service'

type StageTimingsChartProps = {
  timings: StageTimingStats['timings']
}

const chartConfig = {
  dias: {
    label: 'Dias',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig

export function StageTimingsChart({ timings }: StageTimingsChartProps) {
  const chartData = [
    { name: 'Cadastro→Doc', dias: timings.cadToDoc.avgDays ?? 0 },
    { name: 'Doc→Iniciado', dias: timings.docToStart.avgDays ?? 0 },
    { name: 'Iniciado→Final', dias: timings.startToFinal.avgDays ?? 0 },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Tempo medio por transicao (dias)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <XAxis allowDecimals type="number" tickLine={false} axisLine={false} />
            <YAxis
              axisLine={false}
              dataKey="name"
              tickLine={false}
              tickMargin={8}
              type="category"
              width={120}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="dias" fill="var(--color-dias)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
