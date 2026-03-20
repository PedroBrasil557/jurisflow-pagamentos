import { z } from 'zod'

const paginationSchema = z.coerce.number().int().min(1)

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
})

export const updateHousingComplexPayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome do conjunto.')
    .max(160, 'O nome deve ter no maximo 160 caracteres.')
    .transform((value) => value.toUpperCase()),
})

export const housingComplexIdParamsSchema = z.object({
  housingComplexId: z.string().min(1),
})

export const housingComplexOptionsQuerySchema = z.object({
  search: z.string().trim().max(150).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
})
