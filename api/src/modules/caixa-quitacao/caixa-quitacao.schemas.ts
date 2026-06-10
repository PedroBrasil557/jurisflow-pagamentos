import { z } from 'zod'

export const quitacaoResultSchema = z.object({
  processId: z.string().min(1),
  result: z.enum(['quitado', 'nao_encontrado', 'erro']),
  message: z.string().max(5000).default(''),
  pdfBase64: z.string().nullable().optional(),
  pdfFilename: z.string().max(255).nullable().optional(),
})
