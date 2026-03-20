import { z } from 'zod'
import { isValidCpf, normalizeCpf } from '@/features/auth/utils/cpf'

export const emailSchema = z.email({ message: 'Informe um e-mail valido.' })

export const passwordSchema = z
  .string()
  .min(1, { message: 'Informe uma senha.' })
  .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })

export const nameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Informe seu nome.' })
  .max(120, { message: 'Nome muito longo.' })

export const cpfSchema = z
  .string()
  .trim()
  .min(1, { message: 'Informe um CPF.' })
  .transform((value) => normalizeCpf(value))
  .refine((value) => isValidCpf(value), {
    message: 'Informe um CPF valido.',
  })

export const authSearchSchema = z.object({
  redirect: z.string().optional(),
})

export const signInSchema = z.object({
  cpf: cpfSchema,
  password: passwordSchema,
})

export const signUpPayloadSchema = z.object({
  name: nameSchema,
  cpf: cpfSchema,
  email: emailSchema,
  password: passwordSchema,
})

export const signUpFormSchema = signUpPayloadSchema.extend({
  confirmPassword: z
    .string()
    .min(1, { message: 'Confirme sua senha.' })
    .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' }),
})

export const changeInitialPasswordFormSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z
      .string()
      .min(1, { message: 'Confirme a nova senha.' })
      .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' }),
  })
  .superRefine(({ confirmPassword, newPassword }, ctx) => {
    if (newPassword !== confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'As senhas precisam ser iguais.',
      })
    }
  })

export type AuthSearch = z.infer<typeof authSearchSchema>
export type SignInInput = z.input<typeof signInSchema>
export type SignInPayload = z.output<typeof signInSchema>
export type SignUpInput = z.input<typeof signUpFormSchema>
export type SignUpFormPayload = z.output<typeof signUpFormSchema>
export type ChangeInitialPasswordInput = z.input<
  typeof changeInitialPasswordFormSchema
>
export type ChangeInitialPasswordPayload = z.output<
  typeof changeInitialPasswordFormSchema
>

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  const result = authSearchSchema.safeParse(search)

  if (!result.success) {
    return {}
  }

  return result.data
}

export function getValidationErrorMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Dados invalidos.'
}
