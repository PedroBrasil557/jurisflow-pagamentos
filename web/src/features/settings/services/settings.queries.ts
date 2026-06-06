import { queryOptions } from '@tanstack/react-query'
import { fetchAnthropicKeyStatus } from './settings.service'

export const settingsKeys = {
  all: ['settings'] as const,
  anthropicKey: () => [...settingsKeys.all, 'anthropic-key'] as const,
}

export function anthropicKeyStatusOptions() {
  return queryOptions({
    queryKey: settingsKeys.anthropicKey(),
    queryFn: fetchAnthropicKeyStatus,
  })
}
