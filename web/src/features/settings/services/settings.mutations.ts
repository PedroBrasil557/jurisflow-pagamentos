import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsKeys } from './settings.queries'
import {
  clearAnthropicKeyRequest,
  clearScanbotKeyRequest,
  saveAnthropicKeyRequest,
  saveScanbotKeyRequest,
} from './settings.service'

export function useSaveAnthropicKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (anthropicApiKey: string) =>
      saveAnthropicKeyRequest(anthropicApiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
    },
  })
}

export function useClearAnthropicKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => clearAnthropicKeyRequest(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
    },
  })
}

export function useSaveScanbotKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (scanbotLicenseKey: string) =>
      saveScanbotKeyRequest(scanbotLicenseKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
      queryClient.invalidateQueries({ queryKey: ['scanbot-license'] })
    },
  })
}

export function useClearScanbotKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => clearScanbotKeyRequest(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
      queryClient.invalidateQueries({ queryKey: ['scanbot-license'] })
    },
  })
}
