import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'

type ChartItem = { label: string; total: number }

type TitularesPorMunicipioChartProps = {
  items: ChartItem[]
  baseTitle: string
}

const TOP_ITEMS = 10

const chartConfig = {
  total: {
    label: 'Titulares',
    color: 'var(--primary)',
  },
} satisfies ChartConfig

export function TitularesPorMunicipioChart({
  items,
  baseTitle,
}: TitularesPorMunicipioChartProps) {
  const data = items.slice(0, TOP_ITEMS).map((item) => ({
    label: item.label,
    total: item.total,
    agregado: false,
  }))

  const restantes = items.slice(TOP_ITEMS)
  if (restantes.length > 0) {
    data.push({
      label: `Outros (${restantes.length})`,
      total: restantes.reduce((soma, item) => soma + item.total, 0),
      agregado: true,
    })
  }

  const titulo =
    restantes.length > 0 ? `${baseTitle} (top ${TOP_ITEMS})` : baseTitle

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={140}
              tickMargin={8}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="total"
              fill="var(--color-total)"
              radius={[0, 4, 4, 0]}
            >
              {data.map((item) => (
                <Cell
                  key={item.label}
                  fill={
                    item.agregado
                      ? 'var(--muted-foreground)'
                      : 'var(--color-total)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
