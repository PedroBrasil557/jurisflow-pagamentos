import { queryOptions } from '@tanstack/react-query'
import { fetchDashboardStats } from './dashboard.service'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
}

export function dashboardStatsOptions() {
  return queryOptions({
    queryKey: dashboardKeys.stats(),
    queryFn: fetchDashboardStats,
  })
}
