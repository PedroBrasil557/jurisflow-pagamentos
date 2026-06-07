import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import type { ProductivityStats } from '../../services/dashboard.service'

type ProductivityChartProps = {
  data: ProductivityStats['perUser']
}

const chartConfig = {
  total: {
    label: 'Producao',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig

export function ProductivityChart({ data }: ProductivityChartProps) {
  const chartData = data.slice(0, 10).map((item) => ({
    total: item.total,
    name: item.userName.split(' ').slice(0, 2).join(' '),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Top usuarios por producao (top 10)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma atividade registrada no periodo.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
              <XAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                type="number"
              />
              <YAxis
                axisLine={false}
                dataKey="name"
                tickLine={false}
                tickMargin={8}
                type="category"
                width={120}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
