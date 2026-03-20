import { z } from 'zod'
import { cpfSchema, emailSchema, nameSchema } from '../auth/auth.schemas'

const paginationSchema = z.coerce.number().int().min(1)

export const listAdminUsersQuerySchema = z.object({
  limit: paginationSchema.max(100).default(10),
  page: paginationSchema.default(1),
  search: z.string().trim().max(150).optional(),
})

export const createAdminUserPayloadSchema = z.object({
  cpf: cpfSchema,
  email: emailSchema.optional(),
  name: nameSchema,
  role: z.enum(['user', 'admin', 'attorney']),
})

export const updateAdminUserPayloadSchema = z.object({
  email: emailSchema.optional(),
  name: nameSchema,
  role: z.enum(['user', 'admin', 'attorney']),
})

export const userIdParamsSchema = z.object({
  userId: z.string().min(1),
})
