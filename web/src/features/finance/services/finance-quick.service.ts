import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const finance = apiClient.api.finance

export type AllocationPolicy = InferResponseType<
  (typeof finance)['allocation-policy']['$get'],
  200
>

export async function fetchAllocationPolicy() {
  const response = await finance['allocation-policy'].$get()
  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Não foi possível carregar a política de distribuição.',
      ),
    )
  }
  return (await response.json()) as AllocationPolicy
}

export async function linkRecipientUserRequest(input: {
  recipientId: string
  userId: string | null
}) {
  const response = await finance.quick['recipient-user-link'].$post({
    json: input,
  })
  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Não foi possível vincular o usuário ao recebedor.',
      ),
    )
  }
  return response.json()
}
