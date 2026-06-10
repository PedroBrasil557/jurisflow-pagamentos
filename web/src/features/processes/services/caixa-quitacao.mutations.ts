import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reconsultarQuitacaoRequest } from './caixa-quitacao.service'
import { processKeys } from './processes.queries'

export function useReconsultarQuitacao(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => reconsultarQuitacaoRequest(processId),
    // Re-enfileira (202). Marca 'pending' de forma otimista (o polling inicia
    // de imediato) e invalida o detail para buscar a verdade.
    onSuccess: () => {
      queryClient.setQueryData(processKeys.detail(processId), (old) => {
        if (!old || typeof old !== 'object' || !('process' in old)) {
          return old
        }
        const data = old as { process: Record<string, unknown> }
        return {
          ...data,
          process: { ...data.process, caixaQuitacaoStatus: 'pending' },
        }
      })
      queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) })
    },
  })
}
