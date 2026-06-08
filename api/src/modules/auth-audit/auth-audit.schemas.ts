import { z } from 'zod'

const paginationSchema = z.coerce.number().int().min(1)

export const listLoginEventsQuerySchema = z.object({
  limit: paginationSchema.max(100).default(20),
  page: paginationSchema.default(1),
  search: z.string().trim().max(150).optional(),
  status: z.enum(['success', 'failure']).optional(),
  userId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const listActiveSessionsQuerySchema = z.object({
  limit: paginationSchema.max(100).default(20),
  page: paginationSchema.default(1),
  search: z.string().trim().max(150).optional(),
})

export const sessionIdParamsSchema = z.object({
  sessionId: z.string().trim().min(1),
})
