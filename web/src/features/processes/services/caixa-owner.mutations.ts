import { useMutation, useQueryClient } from '@tanstack/react-query'
import { caixaOwnerKeys } from './caixa-owner.queries'
import { reanalyzeCaixaOwnerRequest } from './caixa-owner.service'
import { processKeys } from './processes.queries'

export function useReanalyzeCaixaOwner(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => reanalyzeCaixaOwnerRequest(processId),
    // A analise roda em background (202). Atualiza o detail de forma otimista
    // para 'processing' (assim o polling inicia de imediato, sem flicker) e
    // invalida o detail + a lista de evidencias para buscar a verdade.
    onSuccess: () => {
      queryClient.setQueryData(processKeys.detail(processId), (old) => {
        if (!old || typeof old !== 'object' || !('process' in old)) {
          return old
        }
        const data = old as { process: Record<string, unknown> }
        return {
          ...data,
          process: { ...data.process, caixaAnalysisStatus: 'processing' },
        }
      })
      queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) })
      queryClient.invalidateQueries({
        queryKey: caixaOwnerKeys.analyses(processId),
      })
    },
  })
}
