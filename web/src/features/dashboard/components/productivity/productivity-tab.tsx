import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import { QueryError } from '@/shared/components/query-error'
import { productivityOptions } from '../../services/dashboard.queries'
import type { ProductivityQuery } from '../../services/dashboard.service'
import { ProductivityChart } from './productivity-chart'
import { ProductivityKpis } from './productivity-kpis'
import {
  type ProductivityFilter,
  ProductivityPeriodFilter,
} from './productivity-period-select'
import { ProductivityTable } from './productivity-table'

function toQuery(filter: ProductivityFilter): ProductivityQuery | null {
  if (filter.mode === 'preset') {
    return { period: filter.period }
  }

  if (filter.from && filter.to) {
    return { from: filter.from, to: filter.to }
  }

  return null
}

export function ProductivityTab() {
  const [filter, setFilter] = useState<ProductivityFilter>({
    mode: 'preset',
    period: '30d',
  })

  const query = toQuery(filter)
  const { data, isLoading, isError, refetch } = useQuery({
    ...productivityOptions(query ?? { period: '30d' }),
    enabled: query !== null,
  })

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Producao por usuario no periodo selecionado.
        </p>
        <ProductivityPeriodFilter onChange={setFilter} value={filter} />
      </div>

      {query === null ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/35 px-5 py-10 text-center text-sm text-muted-foreground">
          Selecione a data inicial e final para ver os indicadores.
        </p>
      ) : isError ? (
        <QueryError onRetry={refetch} />
      ) : isLoading || !data ? (
        <ProductivityTabSkeleton />
      ) : (
        <>
          <ProductivityKpis totals={data.totals} />
          <ProductivityTable data={data.perUser} />
          <ProductivityChart data={data.perUser} />
        </>
      )}
    </div>
  )
}

function ProductivityTabSkeleton() {
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4'].map((key) => (
          <Skeleton className="h-[110px] rounded-lg" key={key} />
        ))}
      </section>
      <Skeleton className="h-[320px] rounded-lg" />
      <Skeleton className="h-[370px] rounded-lg" />
    </>
  )
}
