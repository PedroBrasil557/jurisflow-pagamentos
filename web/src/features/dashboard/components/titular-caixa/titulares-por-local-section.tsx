import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '#/components/ui/skeleton'
import { QueryError } from '@/shared/components/query-error'
import { titularCaixaStatsPorLocalOptions } from '../../services/dashboard.queries'
import { TitularesPorLocalTable } from './titulares-por-local-table'
import { TitularesPorMunicipioChart } from './titulares-por-municipio-chart'

// Secao com query propria: carrega em paralelo com os KPIs e falha isolada.
export function TitularesPorLocalSection() {
  const { data, isLoading, isError, refetch } = useQuery(
    titularCaixaStatsPorLocalOptions(),
  )

  if (isError) {
    return <QueryError onRetry={refetch} />
  }

  if (isLoading || !data) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-[300px] rounded-lg" />
        <Skeleton className="h-[240px] rounded-lg" />
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        Por municipio
      </h2>
      {data.municipios.length > 0 ? (
        <TitularesPorMunicipioChart municipios={data.municipios} />
      ) : null}
      <TitularesPorLocalTable municipios={data.municipios} />
    </div>
  )
}
