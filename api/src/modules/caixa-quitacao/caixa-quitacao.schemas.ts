import { z } from 'zod'

export const quitacaoResultSchema = z.object({
  processId: z.string().min(1),
  // Token do claim vigente (fencing): so aceita /result do worker que detem o claim.
  // Opcional por compat. de rolling deploy (worker legado nao envia); quando presente,
  // a service exige que case com o claim vigente. O worker novo sempre envia.
  claimToken: z.string().min(1).max(100).optional(),
  // Resultado POR CPF que o worker tentou (na ordem; para no primeiro 'quitado').
  consultas: z
    .array(
      z.object({
        cpf: z.string().min(1).max(20),
        result: z.enum(['quitado', 'nao_encontrado', 'erro']),
        message: z.string().max(5000).optional(),
      }),
    )
    .min(1)
    .max(5),
  // Teto antes do decode: ~34 MB de base64 ≈ 25 MB binario (o limite do attach).
  // Sem isto, o body e bufferizado/decodificado em memoria antes de qualquer
  // checagem de tamanho -> amplificacao de memoria (DoS).
  pdfBase64: z.string().max(34_000_000).nullable().optional(),
  pdfFilename: z.string().max(255).nullable().optional(),
})
