import { z } from 'zod'

const paginationSchema = z.coerce.number().int().min(1)

function optionalHousingComplexText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, 'Valor muito longo.')
    .transform((value) => (value ? value.toUpperCase() : null))
}

const optionalHousingComplexStateSchema = z
  .string()
  .trim()
  .max(2, 'Informe uma UF valida.')
  .refine((value) => value === '' || /^[A-Za-z]{2}$/.test(value), {
    message: 'Informe uma UF valida.',
  })
  .transform((value) => (value ? value.toUpperCase() : null))

export const listHousingComplexesQuerySchema = z.object({
  limit: paginationSchema.max(100).default(10),
  page: paginationSchema.default(1),
  search: z.string().trim().max(150).optional(),
})

export const createHousingComplexPayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome do conjunto.')
    .max(160, 'O nome deve ter no maximo 160 caracteres.')
    .transform((value) => value.toUpperCase()),
  district: optionalHousingComplexText(120),
  city: optionalHousingComplexText(120),
  state: optionalHousingComplexStateSchema,
  zipcode: optionalHousingComplexText(9),
})

export const updateHousingComplexPayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome do conjunto.')
    .max(160, 'O nome deve ter no maximo 160 caracteres.')
    .transform((value) => value.toUpperCase()),
  district: optionalHousingComplexText(120),
  city: optionalHousingComplexText(120),
  state: optionalHousingComplexStateSchema,
  zipcode: optionalHousingComplexText(9),
})

export const housingComplexIdParamsSchema = z.object({
  housingComplexId: z.string().min(1),
})

export const housingComplexDocumentParamsSchema = z.object({
  housingComplexId: z.string().min(1),
  documentTypeKey: z.string().min(1),
})

export const housingComplexFileParamsSchema = z.object({
  housingComplexId: z.string().min(1),
  fileId: z.string().min(1),
})

export const housingComplexOptionsQuerySchema = z.object({
  search: z.string().trim().max(150).optional(),
  ids: z
    .preprocess(
      (value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : [value],
      z.array(z.string().trim().min(1)).max(100),
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
})
