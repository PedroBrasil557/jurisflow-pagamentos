import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'

const dashboardStatsRoute = apiClient.api.dashboard.stats

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
