import { z } from 'zod'
import { cpfSchema, emailSchema, nameSchema } from '../auth/auth.schemas'

const paginationSchema = z.coerce.number().int().min(1)

export const listAdminUsersQuerySchema = z.object({
  limit: paginationSchema.max(100).default(10),
  page: paginationSchema.default(1),
  search: z.string().trim().max(150).optional(),
})

export const createAdminUserPayloadSchema = z
  .object({
    cpf: cpfSchema,
    email: emailSchema.optional(),
    name: nameSchema,
    isAdmin: z.boolean().default(false),
    profileId: z.string().min(1).optional(),
  })
  .refine((value) => value.isAdmin || !!value.profileId, {
    message: 'Selecione um perfil para o usuario.',
    path: ['profileId'],
  })

export const updateAdminUserPayloadSchema = z.object({
  email: emailSchema.optional(),
  name: nameSchema,
  isAdmin: z.boolean(),
})

export const userIdParamsSchema = z.object({
  userId: z.string().min(1),
})
