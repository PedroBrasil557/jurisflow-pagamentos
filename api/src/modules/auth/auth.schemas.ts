import { z } from 'zod'
import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'

export const emailSchema = z.email({ message: 'Informe um e-mail valido.' })

export const passwordSchema = z
  .string()
  .min(1, { message: 'Informe uma senha.' })
  .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })

export const nameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Informe seu nome.' })
  .max(150, { message: 'Nome muito longo.' })

export const cpfSchema = z
  .string()
  .trim()
  .min(1, { message: 'Informe um CPF.' })
  .transform((value) => normalizeCpf(value))
  .refine((value) => isValidCpf(value), {
    message: 'Informe um CPF valido.',
  })

export const changeInitialPasswordPayloadSchema = z.object({
  newPassword: passwordSchema,
})
