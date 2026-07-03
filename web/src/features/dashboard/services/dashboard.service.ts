import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'

const dashboardStatsRoute = apiClient.api.dashboard.stats
const dashboardProductivityRoute = apiClient.api.dashboard.productivity
const dashboardStageTimingsRoute = apiClient.api.dashboard['stage-timings']
const dashboardTitularCaixaRoute =
  apiClient.api.dashboard['titular-caixa-stats']
const dashboardTitularCaixaPorLocalRoute =
  apiClient.api.dashboard['titular-caixa-stats-por-local']

export type DashboardStats = InferResponseType<
  typeof dashboardStatsRoute.$get,
  200
>

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await dashboardStatsRoute.$get()

  if (!response.ok) {
    throw new Error('Erro ao carregar dados do dashboard.')
  }

  return response.json()
}

export type ProductivityPeriod = '7d' | '30d' | '90d'

export type ProductivityQuery =
  | { period: ProductivityPeriod }
  | { from: string; to: string }

export type ProductivityStats = InferResponseType<
  typeof dashboardProductivityRoute.$get,
  200
>

export async function fetchProductivityStats(
  query: ProductivityQuery,
): Promise<ProductivityStats> {
  const response = await dashboardProductivityRoute.$get({
    query:
      'period' in query
        ? { period: query.period }
        : { from: query.from, to: query.to },
  })

  if (!response.ok) {
    throw new Error('Erro ao carregar indicadores de produtividade.')
  }

  return response.json()
}

export type TitularCaixaStats = InferResponseType<
  typeof dashboardTitularCaixaRoute.$get,
  200
>

export async function fetchTitularCaixaStats(): Promise<TitularCaixaStats> {
  const response = await dashboardTitularCaixaRoute.$get()

  if (!response.ok) {
    throw new Error('Erro ao carregar indicadores de Titular Caixa.')
  }

  return response.json()
}

export type TitularCaixaStatsPorLocal = InferResponseType<
  typeof dashboardTitularCaixaPorLocalRoute.$get,
  200
>

export async function fetchTitularCaixaStatsPorLocal(): Promise<TitularCaixaStatsPorLocal> {
  const response = await dashboardTitularCaixaPorLocalRoute.$get()

  if (!response.ok) {
    throw new Error('Erro ao carregar indicadores por municipio.')
  }

  return response.json()
}

export type StageTimingStats = InferResponseType<
  typeof dashboardStageTimingsRoute.$get,
  200
>

export async function fetchStageTimings(
  query: ProductivityQuery,
): Promise<StageTimingStats> {
  const response = await dashboardStageTimingsRoute.$get({
    query:
      'period' in query
        ? { period: query.period }
        : { from: query.from, to: query.to },
  })

  if (!response.ok) {
    throw new Error('Erro ao carregar indicadores de tempo entre etapas.')
  }

  return response.json()
}
