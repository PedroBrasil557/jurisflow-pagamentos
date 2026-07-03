import { queryOptions } from '@tanstack/react-query'
import {
  fetchDashboardStats,
  fetchProductivityStats,
  fetchStageTimings,
  fetchTitularCaixaStats,
  fetchTitularCaixaStatsPorLocal,
  type ProductivityQuery,
} from './dashboard.service'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  productivity: (query: ProductivityQuery) =>
    [...dashboardKeys.all, 'productivity', query] as const,
  stageTimings: (query: ProductivityQuery) =>
    [...dashboardKeys.all, 'stage-timings', query] as const,
  titularCaixa: () => [...dashboardKeys.all, 'titular-caixa'] as const,
  titularCaixaPorLocal: () =>
    [...dashboardKeys.all, 'titular-caixa', 'por-local'] as const,
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

export function stageTimingsOptions(query: ProductivityQuery) {
  return queryOptions({
    queryKey: dashboardKeys.stageTimings(query),
    queryFn: () => fetchStageTimings(query),
  })
}

export function titularCaixaStatsOptions() {
  return queryOptions({
    queryKey: dashboardKeys.titularCaixa(),
    queryFn: fetchTitularCaixaStats,
  })
}

export function titularCaixaStatsPorLocalOptions() {
  return queryOptions({
    queryKey: dashboardKeys.titularCaixaPorLocal(),
    queryFn: fetchTitularCaixaStatsPorLocal,
  })
}
