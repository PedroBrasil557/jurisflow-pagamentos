import { z } from 'zod'

// Form do terceiro vinculado ao titular (nome + 1..N telefones). Telefones como
// objetos { value } porque useFieldArray nao aceita array de primitivos — o
// submit mapeia para string[] antes de chamar a API.
export const terceiroFormSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome do terceiro.')
    .max(160, 'O nome deve ter no maximo 160 caracteres.'),
  telefones: z
    .array(
      z.object({
        value: z
          .string()
          .trim()
          .min(1, 'Informe o telefone.')
          .max(20, 'Telefone muito longo.'),
      }),
    )
    .min(1, 'Informe ao menos um telefone.')
    .max(10, 'No maximo 10 telefones.'),
})

export type TerceiroFormInput = z.input<typeof terceiroFormSchema>
export type TerceiroFormPayload = z.output<typeof terceiroFormSchema>
