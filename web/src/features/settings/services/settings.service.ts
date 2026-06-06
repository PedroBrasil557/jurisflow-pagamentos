import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const settingsClientRoute = apiClient.api.admin.settings
const anthropicKeyClientRoute = settingsClientRoute['anthropic-key']

export type AnthropicKeyStatus = InferResponseType<
  typeof settingsClientRoute.$get,
  200
>

export async function fetchAnthropicKeyStatus(): Promise<AnthropicKeyStatus> {
  const response = await settingsClientRoute.$get()

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as configuracoes.',
      ),
    )
  }

  return (await response.json()) as AnthropicKeyStatus
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
