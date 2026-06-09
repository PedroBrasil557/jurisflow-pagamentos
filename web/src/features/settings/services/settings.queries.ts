import { queryOptions } from '@tanstack/react-query'
import { fetchSettingsStatus } from './settings.service'

export const settingsKeys = {
  all: ['settings'] as const,
  status: () => [...settingsKeys.all, 'status'] as const,
}

export function settingsStatusOptions() {
  return queryOptions({
    queryKey: settingsKeys.status(),
    queryFn: fetchSettingsStatus,
  })
}
