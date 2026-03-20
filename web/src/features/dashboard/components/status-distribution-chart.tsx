import { Cell, Label, Pie, PieChart } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import type { DashboardStats } from '../services/dashboard.service'

type StatusDistributionChartProps = {
  data: DashboardStats['statusDistribution']
  total: number
}

const statusColors: Record<string, string> = {
  EM_DOCUMENTACAO: 'hsl(45, 93%, 47%)',
  DOCUMENTACAO_PRONTA: 'hsl(210, 100%, 50%)',
  EM_PROCESSO: 'hsl(270, 60%, 55%)',
  FINALIZADO: 'hsl(142, 71%, 45%)',
  CANCELADO: 'hsl(0, 84%, 60%)',
}

export function StatusDistributionChart({
  data,
  total,
}: StatusDistributionChartProps) {
  const chartConfig = data.reduce<ChartConfig>((acc, item) => {
    acc[item.status] = {
      label: item.label,
      color: statusColors[item.status] ?? 'hsl(var(--chart-1))',
    }
    return acc
  }, {})

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Status dos processos
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[280px]"
        >
          <PieChart>
            <ChartTooltip
              content={<ChartTooltipContent nameKey="label" hideLabel />}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius={60}
              outerRadius={100}
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.status}
                  fill={statusColors[entry.status] ?? 'hsl(var(--chart-1))'}
                />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {total}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 24}
                          className="fill-muted-foreground text-sm"
                        >
                          processos
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.map((item) => (
            <div key={item.status} className="flex items-center gap-2 text-sm">
              <div
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{
                  backgroundColor:
                    statusColors[item.status] ?? 'hsl(var(--chart-1))',
                }}
              />
              <span className="truncate text-muted-foreground">
                {item.label}
              </span>
              <span className="ml-auto font-medium">{item.count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
