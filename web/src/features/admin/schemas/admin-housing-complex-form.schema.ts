import { z } from 'zod'

export const housingComplexFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome do conjunto.')
    .max(160, 'O nome deve ter no maximo 160 caracteres.'),
})

export type HousingComplexFormInput = z.input<typeof housingComplexFormSchema>
export type HousingComplexFormPayload = z.output<
  typeof housingComplexFormSchema
>
