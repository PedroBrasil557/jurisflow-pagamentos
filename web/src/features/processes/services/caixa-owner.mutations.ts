import { useMutation, useQueryClient } from '@tanstack/react-query'
import { caixaOwnerKeys } from './caixa-owner.queries'
import { reanalyzeCaixaOwnerRequest } from './caixa-owner.service'
import { processKeys } from './processes.queries'

export function useReanalyzeCaixaOwner(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => reanalyzeCaixaOwnerRequest(processId),
    // A analise roda em background (202). Invalida o detail (que tem o
    // caixaAnalysisStatus, com polling enquanto 'processing') e a lista de
    // evidencias.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) })
      queryClient.invalidateQueries({
        queryKey: caixaOwnerKeys.analyses(processId),
      })
    },
  })
}
