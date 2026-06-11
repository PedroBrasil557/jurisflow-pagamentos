import { useMutation, useQueryClient } from '@tanstack/react-query'
import { processKeys } from './processes.queries'
import { procuracaoConjuntoKeys } from './procuracao-conjunto.queries'
import { reanalyzeProcuracaoConjuntoRequest } from './procuracao-conjunto.service'

export function useReanalyzeProcuracaoConjunto(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => reanalyzeProcuracaoConjuntoRequest(processId),
    // Roda em background (202). Otimista para 'processing' (inicia o polling sem
    // flicker) + invalida o detail e a lista de evidencias.
    onSuccess: () => {
      queryClient.setQueryData(processKeys.detail(processId), (old) => {
        if (!old || typeof old !== 'object' || !('process' in old)) {
          return old
        }
        const data = old as { process: Record<string, unknown> }
        return {
          ...data,
          process: {
            ...data.process,
            procuracaoConjuntoStatus: 'processing',
          },
        }
      })
      queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) })
      queryClient.invalidateQueries({
        queryKey: procuracaoConjuntoKeys.analyses(processId),
      })
    },
  })
}
