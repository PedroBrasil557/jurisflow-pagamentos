import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reconsultarQuitacaoRequest } from './caixa-quitacao.service'
import { processKeys } from './processes.queries'

export function useReconsultarQuitacao(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => reconsultarQuitacaoRequest(processId),
    // Re-enfileira (202). Invalida o detail (tem o caixaQuitacaoStatus, com
    // polling enquanto pending/processing).
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) })
    },
  })
}
