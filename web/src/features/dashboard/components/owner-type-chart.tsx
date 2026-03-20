import { Cell, Label, Pie, PieChart } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import type { DashboardStats } from '../services/dashboard.service'

type OwnerTypeChartProps = {
  data: DashboardStats['ownerTypeDistribution']
}

const ownerColors = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

export function OwnerTypeChart({ data }: OwnerTypeChartProps) {
  const total = data.reduce((sum, item) => sum + item.count, 0)

  const chartConfig = data.reduce<ChartConfig>((acc, item, index) => {
    acc[item.ownerType] = {
      label: item.label,
      color: ownerColors[index % ownerColors.length],
    }
    return acc
  }, {})

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Tipos de proprietario
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
              {data.map((entry, index) => (
                <Cell
                  key={entry.ownerType}
                  fill={ownerColors[index % ownerColors.length]}
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
          {data.map((item, index) => (
            <div
              key={item.ownerType}
              className="flex items-center gap-2 text-sm"
            >
              <div
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{
                  backgroundColor: ownerColors[index % ownerColors.length],
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
