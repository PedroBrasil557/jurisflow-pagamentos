import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const settingsClientRoute = apiClient.api.admin.settings
const anthropicKeyClientRoute = settingsClientRoute['anthropic-key']
const scanbotKeyClientRoute = settingsClientRoute['scanbot-license']
const scannerProviderClientRoute = settingsClientRoute['scanner-provider']

export type SettingsStatus = InferResponseType<
  typeof settingsClientRoute.$get,
  200
>
export type KeyStatus = SettingsStatus['anthropic']
export type ScannerProvider = 'scanbot' | 'web' | 'docaligner'

export async function fetchSettingsStatus(): Promise<SettingsStatus> {
  const response = await settingsClientRoute.$get()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as configuracoes.',
      ),
    )
  }

  return (await response.json()) as SettingsStatus
}

export async function saveAnthropicKeyRequest(anthropicApiKey: string) {
  const response = await anthropicKeyClientRoute.$put({
    json: { anthropicApiKey },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel salvar a chave da API.',
      ),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof anthropicKeyClientRoute.$put,
    200
  >
}

export async function clearAnthropicKeyRequest() {
  const response = await anthropicKeyClientRoute.$delete()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel remover a chave da API.',
      ),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof anthropicKeyClientRoute.$delete,
    200
  >
}

export async function saveScanbotKeyRequest(scanbotLicenseKey: string) {
  const response = await scanbotKeyClientRoute.$put({
    json: { scanbotLicenseKey },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel salvar a license do Scanbot.',
      ),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof scanbotKeyClientRoute.$put,
    200
  >
}

export async function saveScannerProviderRequest(provider: ScannerProvider) {
  const response = await scannerProviderClientRoute.$put({
    json: { provider },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel salvar o servico de digitalizacao.',
      ),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof scannerProviderClientRoute.$put,
    200
  >
}

export async function clearScanbotKeyRequest() {
  const response = await scanbotKeyClientRoute.$delete()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel remover a license do Scanbot.',
      ),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof scanbotKeyClientRoute.$delete,
    200
  >
}
