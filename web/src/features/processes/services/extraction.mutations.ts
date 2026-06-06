import { useMutation } from '@tanstack/react-query'
import { extractDocumentsRequest } from './extraction.service'

// Extracao de documentos via IA. Stateless — sem invalidacao de cache.
export function useExtractDocuments() {
  return useMutation({
    mutationFn: (file: File) => extractDocumentsRequest(file),
  })
}
