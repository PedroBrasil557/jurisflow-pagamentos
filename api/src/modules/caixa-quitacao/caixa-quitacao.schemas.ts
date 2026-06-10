import { z } from 'zod'

export const quitacaoResultSchema = z.object({
  processId: z.string().min(1),
  result: z.enum(['quitado', 'nao_encontrado', 'erro']),
  message: z.string().max(5000).default(''),
  // Teto antes do decode: ~34 MB de base64 ≈ 25 MB binario (o limite do attach).
  // Sem isto, o body e bufferizado/decodificado em memoria antes de qualquer
  // checagem de tamanho -> amplificacao de memoria (DoS).
  pdfBase64: z.string().max(34_000_000).nullable().optional(),
  pdfFilename: z.string().max(255).nullable().optional(),
})
