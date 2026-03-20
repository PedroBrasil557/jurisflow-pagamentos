import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
    mutationCache: new MutationCache({
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Ocorreu um erro inesperado.',
        )
      },
    }),
  })
}
