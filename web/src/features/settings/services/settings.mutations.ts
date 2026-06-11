import { useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsKeys } from './settings.queries'
import {
  clearAnthropicKeyRequest,
  clearScanbotKeyRequest,
  type ScannerProvider,
  saveAnthropicKeyRequest,
  saveCaixaOwnerAutoApplyRequest,
  saveProcuracaoConjuntoAutoApplyRequest,
  saveScanbotKeyRequest,
  saveScannerProviderRequest,
} from './settings.service'

export function useSaveCaixaOwnerAutoApply() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (enabled: boolean) => saveCaixaOwnerAutoApplyRequest(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
    },
  })
}

export function useSaveProcuracaoConjuntoAutoApply() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (enabled: boolean) =>
      saveProcuracaoConjuntoAutoApplyRequest(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
    },
  })
}

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

export function useSaveScannerProvider() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (provider: ScannerProvider) =>
      saveScannerProviderRequest(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.status() })
      queryClient.invalidateQueries({ queryKey: ['scanner-provider'] })
    },
  })
}
