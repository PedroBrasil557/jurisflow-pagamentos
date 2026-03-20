import { z } from 'zod'
import { userRoles } from '@/features/auth/auth.roles'
import {
  cpfSchema,
  emailSchema,
  nameSchema,
} from '@/features/auth/schemas/auth.schema'

export const adminUserFormSchema = z.object({
  cpf: cpfSchema,
  email: emailSchema.optional().or(z.literal('')),
  name: nameSchema,
  role: z.enum(userRoles),
})

export type AdminUserFormInput = z.input<typeof adminUserFormSchema>
export type AdminUserFormPayload = z.output<typeof adminUserFormSchema>
