import { z } from 'zod'

function optionalHousingComplexText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, 'Valor muito longo.')
    .transform((value) => value.toUpperCase())
}

export const housingComplexFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome do conjunto.')
    .max(160, 'O nome deve ter no maximo 160 caracteres.')
    .transform((value) => value.toUpperCase()),
  district: optionalHousingComplexText(120),
  city: optionalHousingComplexText(120),
  state: z
    .string()
    .trim()
    .max(2, 'Informe uma UF valida.')
    .refine((value) => value === '' || /^[A-Za-z]{2}$/.test(value), {
      message: 'Informe uma UF valida.',
    })
    .transform((value) => value.toUpperCase()),
  zipcode: optionalHousingComplexText(9),
  vara: optionalHousingComplexText(120),
  causeValue: z
    .string()
    .trim()
    .max(20, 'Valor muito longo.')
    .refine((value) => value === '' || /^\d+([.,]\d{1,2})?$/.test(value), {
      message: 'Informe um valor numerico valido (ex: 1400,00).',
    }),
})

export type HousingComplexFormInput = z.input<typeof housingComplexFormSchema>
export type HousingComplexFormPayload = z.output<
  typeof housingComplexFormSchema
>
