import { z } from 'zod'

// Lista resumida de analises de um processo (sem output/input/decision, que
// podem conter PII).
export const aiAnalysisListQuerySchema = z.object({
  kind: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const aiAnalysisProcessParamsSchema = z.object({
  processId: z.string().min(1),
})

export const aiAnalysisDetailParamsSchema = z.object({
  processId: z.string().min(1),
  id: z.string().min(1),
})

export type AiAnalysisListQuery = z.infer<typeof aiAnalysisListQuerySchema>
