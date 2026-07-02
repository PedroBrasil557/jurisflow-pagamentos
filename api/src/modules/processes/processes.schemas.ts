import { z } from 'zod'
import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'
import { processStatuses } from './processes.status'

const binaryChoiceValues = ['', 'sim', 'nao'] as const
const ternaryChoiceValues = ['', 'sim', 'nao', 'nao_sei'] as const
const maritalStatusValues = [
  '',
  'solteiro',
  'casado',
  'separado_judicialmente',
  'divorciado',
  'viuvo',
] as const
const ownerTypeValues = [
  '',
  'titular_contrato_caixa',
  'nao_titular_contrato_caixa',
] as const

const processCpfSchema = z
  .string()
  .trim()
  .min(1, { message: 'Informe um CPF.' })
  .transform((value) => normalizeCpf(value))
  .refine((value) => isValidCpf(value), {
    message: 'Informe um CPF valido.',
  })

const emailValidator = z.email({ message: 'Informe um e-mail valido.' })

function toUppercase(value: string) {
  return value.trim().toUpperCase()
}

function requiredUppercaseText(message: string, maxLength = 255) {
  return z
    .string()
    .trim()
    .min(1, { message })
    .max(maxLength, { message: 'Valor muito longo.' })
    .transform(toUppercase)
}

function optionalUppercaseText(maxLength = 255) {
  return z
    .string()
    .trim()
    .max(maxLength, { message: 'Valor muito longo.' })
    .transform((value) => value.toUpperCase())
}

function optionalText(maxLength = 255) {
  return z.string().trim().max(maxLength, { message: 'Valor muito longo.' })
}

const birthDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Informe uma data de nascimento valida.',
  })

const processPayloadShape = {
  fullName: requiredUppercaseText('Informe o nome completo.', 150),
  birthDate: birthDateSchema,
  nationality: requiredUppercaseText('Informe a nacionalidade.', 80),
  maritalStatus: z.enum(maritalStatusValues),
  profession: optionalUppercaseText(120),
  // Opcional: a analise do contrato Caixa pode preencher depois (ou o usuario
  // define manualmente ao editar).
  ownerType: z.enum(ownerTypeValues),
  cpf: processCpfSchema,
  rg: requiredUppercaseText('Informe o RG.', 40),
  cadunico: z.enum(binaryChoiceValues),
  propertyPaidOff: z.enum(ternaryChoiceValues),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, { message: 'Informe uma UF valida.' })
    .transform((value) => value.toUpperCase()),
  city: requiredUppercaseText('Informe a cidade.', 120),
  district: requiredUppercaseText('Informe o bairro.', 120),
  housingComplex: requiredUppercaseText(
    'Informe o conjunto ou residencial.',
    160,
  ),
  street: requiredUppercaseText('Informe o logradouro.', 255),
  number: optionalUppercaseText(40),
  complement: optionalUppercaseText(255),
  zipcode: z
    .string()
    .trim()
    .min(1, { message: 'Informe o CEP.' })
    .max(20, { message: 'CEP invalido.' }),
  email: z
    .string()
    .trim()
    .max(255, { message: 'E-mail muito longo.' })
    .refine(
      (value) => value === '' || emailValidator.safeParse(value).success,
      {
        message: 'Informe um e-mail valido.',
      },
    )
    .transform((value) => value.toLowerCase()),
  whatsapp: optionalText(30),
  spouseContractSigned: z.enum(binaryChoiceValues),
  spouseFullName: optionalUppercaseText(150),
  spouseBirthDate: z
    .union([z.string().trim(), z.null()])
    .optional()
    .default('')
    .transform((value) => (!value ? null : value)),
  spouseNationality: optionalUppercaseText(80),
  spouseMaritalStatus: z.enum(maritalStatusValues),
  spouseProfession: optionalUppercaseText(120),
  spouseCpf: optionalText(14),
  spouseRg: optionalUppercaseText(40),
  spouseCadunico: z.enum(binaryChoiceValues),
  spouseSameAddress: z.enum(binaryChoiceValues),
  spouseState: optionalText(2),
  spouseCity: optionalUppercaseText(120),
  spouseDistrict: optionalUppercaseText(120),
  spouseHousingComplex: optionalUppercaseText(160),
  spouseStreet: optionalUppercaseText(255),
  spouseNumber: optionalUppercaseText(40),
  spouseComplement: optionalUppercaseText(255),
  spouseZipcode: optionalText(20),
  witness1Id: z.string().trim().optional().default(''),
  witness2Id: z.string().trim().optional().default(''),
  observation: optionalUppercaseText(500),
} satisfies z.ZodRawShape

function applyCrossFieldRules<
  T extends {
    spouseContractSigned?: string
    spouseFullName?: string
    spouseBirthDate?: string | null
    spouseCpf?: string
    spouseRg?: string
    spouseState?: string
    spouseCity?: string
    spouseDistrict?: string
    spouseHousingComplex?: string
    spouseStreet?: string
    spouseZipcode?: string
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.spouseContractSigned === 'sim') {
    if (!data.spouseFullName?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseFullName'],
        message: 'Informe o nome completo do conjuge.',
      })
    }

    if (
      !data.spouseBirthDate?.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.spouseBirthDate)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseBirthDate'],
        message: 'Informe a data de nascimento do conjuge.',
      })
    }

    if (!data.spouseCpf?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseCpf'],
        message: 'Informe o CPF do conjuge.',
      })
    } else if (!isValidCpf(normalizeCpf(data.spouseCpf))) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseCpf'],
        message: 'Informe um CPF valido.',
      })
    }

    if (!data.spouseRg?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseRg'],
        message: 'Informe o RG do conjuge.',
      })
    }

    if (!data.spouseState?.trim() || !/^[A-Za-z]{2}$/.test(data.spouseState)) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseState'],
        message: 'Informe a UF do conjuge.',
      })
    }

    if (!data.spouseCity?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseCity'],
        message: 'Informe a cidade do conjuge.',
      })
    }

    if (!data.spouseDistrict?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseDistrict'],
        message: 'Informe o bairro do conjuge.',
      })
    }

    if (!data.spouseHousingComplex?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseHousingComplex'],
        message: 'Informe o conjunto ou residencial do conjuge.',
      })
    }

    if (!data.spouseStreet?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseStreet'],
        message: 'Informe o logradouro do conjuge.',
      })
    }

    if (!data.spouseZipcode?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['spouseZipcode'],
        message: 'Informe o CEP do conjuge.',
      })
    }
  }
}

export const createProcessPayloadSchema = z
  .object(processPayloadShape)
  .superRefine((data, ctx) => {
    applyCrossFieldRules(data, ctx)
  })

export const updateProcessPayloadSchema = z
  .object(processPayloadShape)
  .partial()
  .superRefine((data, ctx) => {
    applyCrossFieldRules(data, ctx)
  })

export const listProcessesQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120, { message: 'Busca muito longa.' })
    .optional(),
  status: z.enum(processStatuses).optional(),
  statuses: z
    .preprocess(
      (value) =>
        value === undefined
          ? undefined
          : Array.isArray(value)
            ? value
            : [value],
      z.array(z.enum(processStatuses)),
    )
    .optional(),
  ownerTypes: z
    .preprocess(
      (value) =>
        value === undefined
          ? undefined
          : Array.isArray(value)
            ? value
            : [value],
      z.array(
        z.enum(['titular_contrato_caixa', 'nao_titular_contrato_caixa']),
      ),
    )
    .optional(),
  housingComplexIds: z
    .preprocess(
      (value) =>
        value === undefined
          ? undefined
          : Array.isArray(value)
            ? value
            : [value],
      z.array(z.string().trim().min(1)),
    )
    .optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  // Query param chega como string — coerco explicito ('true'/'false'); ausente vira
  // false. NAO usar z.coerce.boolean (qualquer string nao-vazia viraria true).
  needsClassificationReview: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const processIdParamsSchema = z.object({
  processId: z.string().trim().min(1, {
    message: 'Informe o processo.',
  }),
})

export const processChecklistItemParamsSchema = z.object({
  processId: z.string().trim().min(1, {
    message: 'Informe o processo.',
  }),
  processDocumentId: z.string().trim().min(1, {
    message: 'Informe o item do checklist.',
  }),
})

export const processChecklistFileParamsSchema = z.object({
  processId: z.string().trim().min(1, {
    message: 'Informe o processo.',
  }),
  processDocumentId: z.string().trim().min(1, {
    message: 'Informe o item do checklist.',
  }),
  fileId: z.string().trim().min(1, {
    message: 'Informe o arquivo.',
  }),
})

export const processPdfModelParamsSchema = z.object({
  processId: z.string().trim().min(1, {
    message: 'Informe o processo.',
  }),
  modelKey: z.string().trim().min(1, {
    message: 'Informe um modelo valido.',
  }),
})

const legalProcessFields = {
  legalProcessNumber: z
    .string()
    .trim()
    .min(1, { message: 'Informe o numero do processo.' })
    .max(50, { message: 'Numero do processo muito longo.' }),
  causeValue: z
    .string()
    .trim()
    .min(1, { message: 'Informe o valor da causa.' })
    .regex(/^\d+([.,]\d{1,2})?$/, {
      message: 'Informe um valor numerico valido (ex: 1400,00).',
    }),
  protocolDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'Informe uma data valida no formato AAAA-MM-DD.',
    }),
}

export const startProcessPayloadSchema = z.object(legalProcessFields)

export const updateLegalProcessPayloadSchema = z.object(legalProcessFields)

export const cancelProcessPayloadSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, { message: 'Motivo muito longo.' })
    .optional(),
})

export const submitChecklistItemFormSchema = z.object({
  observation: z.string().optional(),
  markOkWithoutFile: z.string().optional(),
  file: z.unknown().optional(),
})

export type CreateProcessPayload = z.output<typeof createProcessPayloadSchema>
export type UpdateProcessPayload = z.output<typeof updateProcessPayloadSchema>
export type ListProcessesQuery = z.output<typeof listProcessesQuerySchema>
export type CancelProcessPayload = z.output<typeof cancelProcessPayloadSchema>
export type StartProcessPayload = z.output<typeof startProcessPayloadSchema>
export type UpdateLegalProcessPayload = z.output<
  typeof updateLegalProcessPayloadSchema
>

export const processBatchFileParamsSchema = z.object({
  processId: z.string().trim().min(1, {
    message: 'Informe o processo.',
  }),
  fileId: z.string().trim().min(1, {
    message: 'Informe o arquivo.',
  }),
})

export const setDocumentationAssigneePayloadSchema = z.object({
  assigneeUserId: z.string().trim().min(1, {
    message: 'Informe o usuário responsável.',
  }),
})

export type SetDocumentationAssigneePayload = z.output<
  typeof setDocumentationAssigneePayloadSchema
>

export function normalizeProcessPayload(input: unknown) {
  return createProcessPayloadSchema.parse(input)
}

// Import via upload pre-assinado S3 (browser sobe direto no S3, sem passar pela
// API — contorna o teto de 10MB do API Gateway).
const IMPORT_MAX_FILES = 20

export const presignImportBodySchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.string().min(1).max(128),
        size: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(IMPORT_MAX_FILES),
})

export const completeImportBodySchema = z.object({
  processId: z.string().min(1),
  files: z
    .array(
      z.object({
        fileId: z.string().min(1),
        objectKey: z.string().min(1).max(1024),
        fileName: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(IMPORT_MAX_FILES),
})

// Scan via upload pre-assinado S3 (uma sessao = um PDF). Igual ao import, mas a
// sessao e um uploadId opaco (sem processo ate o complete).
export const presignScanBodySchema = z.object({
  contentType: z.string().min(1).max(128),
  size: z.number().int().positive(),
})

export const completeScanBodySchema = z.object({
  // uuid: o presign sempre gera uuid; restringe o formato do PK controlado pelo
  // cliente (reduz superficie de colisao/probe).
  uploadId: z.string().uuid(),
  objectKey: z.string().min(1).max(1024),
})
