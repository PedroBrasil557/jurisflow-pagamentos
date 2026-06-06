import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsKeys } from './settings.queries'
import {
  clearAnthropicKeyRequest,
  saveAnthropicKeyRequest,
} from './settings.service'

export function useSaveAnthropicKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (anthropicApiKey: string) =>
      saveAnthropicKeyRequest(anthropicApiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.anthropicKey() })
    },
  })
}

export function useClearAnthropicKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => clearAnthropicKeyRequest(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.anthropicKey() })
    },
  })
}
