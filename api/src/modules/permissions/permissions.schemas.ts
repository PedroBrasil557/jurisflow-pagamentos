import { z } from 'zod'

const processScopeValues = ['own', 'housing_complex', 'all'] as const

const profilePermissionsSchema = z.object({
  process: z.object({
    create: z.boolean(),
    viewOwn: z.boolean(),
    editOwn: z.boolean(),
    editAny: z.boolean(),
    startLegal: z.boolean(),
    editLegal: z.boolean(),
    finalize: z.boolean(),
    cancelOwn: z.boolean(),
    cancelAny: z.boolean(),
    markDocumentationReady: z.boolean(),
    uploadChecklist: z.boolean(),
    deleteChecklistFile: z.boolean(),
    viewBatch: z.boolean(),
    uploadBatch: z.boolean(),
    deleteBatch: z.boolean(),
    generatePdf: z.boolean(),
  }),
  sections: z.object({
    dashboard: z.boolean(),
    checklist: z.boolean(),
    documentation: z.boolean(),
    legalData: z.boolean(),
    history: z.boolean(),
    batch: z.boolean(),
  }),
  titularCaixa: z.object({
    view: z.boolean(),
    export: z.boolean(),
    import: z.boolean(),
    reconsultar: z.boolean(),
  }),
})

export const createProfilePayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Informe o nome do perfil.' })
    .max(100),
  description: z.string().trim().max(500).optional(),
  processScope: z.enum(processScopeValues, {
    message: 'Informe um escopo de processo valido.',
  }),
  permissions: profilePermissionsSchema,
  housingComplexIds: z.array(z.string().trim().min(1)).default([]),
})

export const updateProfilePayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'Informe o nome do perfil.' })
    .max(100),
  description: z.string().trim().max(500).optional(),
  processScope: z.enum(processScopeValues, {
    message: 'Informe um escopo de processo valido.',
  }),
  permissions: profilePermissionsSchema,
  housingComplexIds: z.array(z.string().trim().min(1)).default([]),
})

export const profileIdParamsSchema = z.object({
  profileId: z.string().trim().min(1, { message: 'Informe o perfil.' }),
})

export const listProfilesQuerySchema = z.object({
  search: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const assignProfilePayloadSchema = z.object({
  profileId: z.string().trim().min(1, { message: 'Informe o perfil.' }),
})

export const updateUserHousingComplexesPayloadSchema = z.object({
  housingComplexIds: z.array(z.string().trim().min(1)).default([]),
})

export type CreateProfilePayload = z.output<typeof createProfilePayloadSchema>
export type UpdateProfilePayload = z.output<typeof updateProfilePayloadSchema>
export type ListProfilesQuery = z.output<typeof listProfilesQuerySchema>
export type AssignProfilePayload = z.output<typeof assignProfilePayloadSchema>
export type UpdateUserHousingComplexesPayload = z.output<
  typeof updateUserHousingComplexesPayloadSchema
>
