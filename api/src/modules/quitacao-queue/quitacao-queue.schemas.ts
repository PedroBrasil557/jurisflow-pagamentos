import { z } from 'zod'

// Corpo do /result postado pelo worker RPA.
export const quitacaoJobResultSchema = z.object({
  jobId: z.string().min(1),
  // Fencing token devolvido no /claim (correlaciona o resultado com o claim vigente).
  leaseToken: z.string().min(1),
  result: z.enum(['quitado', 'nao_encontrado', 'erro']),
  message: z.string().max(5000).nullable().optional(),
  // Teto antes do decode: ~34 MB de base64 ≈ 25 MB binario. Sem isto, o corpo e
  // bufferizado/decodificado em memoria antes de qualquer checagem -> amplificacao
  // de memoria (DoS).
  pdfBase64: z.string().max(34_000_000).nullable().optional(),
  pdfFilename: z.string().max(255).nullable().optional(),
})
