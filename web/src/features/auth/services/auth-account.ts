import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'

const changeInitialPasswordRoute =
  apiClient.api.session['change-initial-password']

type ChangeInitialPasswordResponse = InferResponseType<
  typeof changeInitialPasswordRoute.$post,
  200
>

export async function changeInitialPasswordRequest(newPassword: string) {
  const response = await changeInitialPasswordRoute.$post({
    json: {
      newPassword,
    },
  })

  if (!response.ok) {
    try {
      const body = (await response.json()) as { message?: string }

      throw new Error(
        body.message ?? 'Nao foi possivel atualizar a senha inicial.',
      )
    } catch {
      throw new Error('Nao foi possivel atualizar a senha inicial.')
    }
  }

  return (await response.json()) as ChangeInitialPasswordResponse
}
