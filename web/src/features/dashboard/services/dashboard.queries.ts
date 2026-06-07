import { queryOptions } from '@tanstack/react-query'
import {
  fetchDashboardStats,
  fetchProductivityStats,
  type ProductivityQuery,
} from './dashboard.service'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  productivity: (query: ProductivityQuery) =>
    [...dashboardKeys.all, 'productivity', query] as const,
}

export function dashboardStatsOptions() {
  return queryOptions({
    queryKey: dashboardKeys.stats(),
    queryFn: fetchDashboardStats,
  })
}

export function productivityOptions(query: ProductivityQuery) {
  return queryOptions({
    queryKey: dashboardKeys.productivity(query),
    queryFn: () => fetchProductivityStats(query),
  })
}
