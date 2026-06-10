import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const reconsultarRoute =
  apiClient.api.processes[':processId']['caixa-quitacao'].reconsultar

export async function reconsultarQuitacaoRequest(processId: string) {
  const response = await reconsultarRoute.$post({ param: { processId } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel reconsultar a quitacao na Caixa.',
      ),
    )
  }

  return response.json()
}
