import { z } from 'zod'
import {
  cpfSchema,
  emailSchema,
  nameSchema,
} from '@/features/auth/schemas/auth.schema'

export const adminUserFormSchema = z
  .object({
    cpf: cpfSchema,
    email: emailSchema.optional().or(z.literal('')),
    name: nameSchema,
    isAdmin: z.boolean(),
    profileId: z.string().optional().or(z.literal('')),
  })
  .superRefine((value, ctx) => {
    if (!value.isAdmin && !value.profileId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Selecione um perfil para o usuario.',
        path: ['profileId'],
      })
    }
  })

export type AdminUserFormInput = z.input<typeof adminUserFormSchema>
export type AdminUserFormPayload = z.output<typeof adminUserFormSchema>
