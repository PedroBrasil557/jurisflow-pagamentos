import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '#/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import { QueryError } from '@/shared/components/query-error'
import { CreationTimelineChart } from '../components/creation-timeline-chart'
import { KpiCards } from '../components/kpi-cards'
import { OwnerTypeChart } from '../components/owner-type-chart'
import { ProductivityTab } from '../components/productivity/productivity-tab'
import { StageTimingsTab } from '../components/stage-timings/stage-timings-tab'
import { StatusDistributionChart } from '../components/status-distribution-chart'
import { TopCreatorsChart } from '../components/top-creators-chart'
import { TopHousingComplexesChart } from '../components/top-housing-complexes-chart'
import { dashboardStatsOptions } from '../services/dashboard.queries'

export function DashboardPage() {
  const { permissions } = useSession()

  if (!permissions.isAdmin) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Dashboard" description="Visao geral do sistema" />
        <OverviewSection />
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="Dashboard" description="Visao geral do sistema" />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visao geral</TabsTrigger>
          <TabsTrigger value="productivity">Produtividade</TabsTrigger>
          <TabsTrigger value="stage-timings">Tempo entre etapas</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewSection />
        </TabsContent>

        <TabsContent value="productivity">
          <ProductivityTab />
        </TabsContent>

        <TabsContent value="stage-timings">
          <StageTimingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function OverviewSection() {
  const { data, isLoading, isError, refetch } = useQuery(dashboardStatsOptions())

  if (isError) {
    return <QueryError onRetry={refetch} />
  }

  if (isLoading || !data) {
    return <DashboardSkeleton />
  }

  return (
    <div className="grid gap-6">
      <KpiCards summary={data.summary} />

      <section className="grid gap-6 xl:grid-cols-2">
        <StatusDistributionChart
          data={data.statusDistribution}
          total={data.summary.total}
        />
        <OwnerTypeChart data={data.ownerTypeDistribution} />
      </section>

      <CreationTimelineChart data={data.creationTimeline} />

      <section className="grid gap-6 xl:grid-cols-2">
        <TopCreatorsChart data={data.topCreators} />
        <TopHousingComplexesChart data={data.topHousingComplexes} />
      </section>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['kpi-1', 'kpi-2', 'kpi-3', 'kpi-4'].map((key) => (
          <Skeleton key={key} className="h-[120px] rounded-lg" />
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-[400px] rounded-lg" />
        <Skeleton className="h-[400px] rounded-lg" />
      </section>
      <Skeleton className="h-[370px] rounded-lg" />
      <section className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-[370px] rounded-lg" />
        <Skeleton className="h-[370px] rounded-lg" />
      </section>
    </div>
  )
}
