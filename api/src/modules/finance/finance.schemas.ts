import { z } from 'zod'
import {
  financeCreditStatuses,
  financeRuleNatures,
  financeRuleStages,
  financeUniquenessPolicies,
  financeValueTypes,
} from './finance.engine'
import {
  financeReceiptKinds,
  financeReceiptStatuses,
  financeRecipientKinds,
} from './finance.schema'

const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inválida (AAAA-MM-DD).' })
  .refine(
    (value) =>
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    { message: 'Data inválida.' },
  )
const cents = z
  .number({ message: 'Valor inválido.' })
  .int({ message: 'Valor deve estar em centavos inteiros.' })
  .max(Number.MAX_SAFE_INTEGER)
const idempotencyKey = z
  .string()
  .trim()
  .min(8, { message: 'Chave de idempotência obrigatória.' })
  .max(128)
const reason = z
  .string()
  .trim()
  .min(3, { message: 'Informe o motivo.' })
  .max(500)
const id = z.string().trim().min(1).max(64)

export const idParamSchema = z.object({ id })

export const recipientPayloadSchema = z.object({
  name: z.string().trim().min(1, { message: 'Informe o nome.' }).max(200),
  kind: z.enum(financeRecipientKinds),
  document: z.string().trim().max(32).optional(),
  paymentNote: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
})

export const recipientUpdateSchema = recipientPayloadSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const rulePayloadSchema = z.object({
  stage: z.enum(financeRuleStages),
  nature: z.enum(financeRuleNatures),
  recipientId: z.string().trim().min(1).nullable().optional(),
  poolLabel: z.string().trim().max(120).nullable().optional(),
  workType: z.string().trim().max(120).optional(),
  valueType: z.enum(financeValueTypes),
  // null = "nao configurado" (bloqueia o calculo); 0 = 0% configurado (valido)
  basisPoints: z.number().int().min(0).max(10_000).nullable().optional(),
  fixedCents: cents.min(0).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  uniqueness: z.enum(financeUniquenessPolicies).optional(),
  validFrom: civilDate,
  validTo: civilDate.nullable().optional(),
  housingComplexIds: z
    .array(id)
    .min(1, { message: 'Vincule pelo menos um condomínio.' })
    .max(500),
  notes: z.string().trim().max(1000).optional(),
})

export const reasonPayloadSchema = z.object({ reason })

export const receiptPayloadSchema = z.object({
  idempotencyKey,
  processId: id,
  kind: z.enum(financeReceiptKinds),
  amountCents: cents.positive({ message: 'O valor deve ser maior que zero.' }),
  releaseDate: civilDate.nullable().optional(),
  reference: z.string().trim().max(200).optional(),
  originDescription: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
})

export const receiptUpdateSchema = receiptPayloadSchema
  .omit({ idempotencyKey: true, processId: true })
  .partial()
  .extend({ version: z.number().int().min(1) })

const csvList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.array(z.enum(values))])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    )

export const receiptListQuerySchema = z.object({
  status: csvList(financeReceiptStatuses),
  processId: id.optional(),
  search: z.string().trim().max(120).optional(),
})

export const closingPayloadSchema = z.object({
  receiptIds: z
    .array(id)
    .min(1, { message: 'Selecione ao menos um recebimento.' })
    .max(500),
  periodStart: civilDate,
  periodEnd: civilDate,
  notes: z.string().trim().max(1000).optional(),
})

export const closingCreateSchema = closingPayloadSchema.extend({
  idempotencyKey,
})

export const creditQuerySchema = z.object({
  closingId: id.optional(),
  recipientId: id.optional(),
  processId: id.optional(),
  status: csvList(financeCreditStatuses),
})

export const payoutPayloadSchema = z.object({
  idempotencyKey,
  creditId: id,
  amountCents: cents.positive({
    message: 'O valor da baixa deve ser maior que zero.',
  }),
  paidOn: civilDate,
  reference: z
    .string()
    .trim()
    .min(1, { message: 'Informe a referência da transferência.' })
    .max(200),
  notes: z.string().trim().max(1000).optional(),
})

export const payoutQuerySchema = z.object({
  creditId: id.optional(),
  recipientId: id.optional(),
})

export const adjustmentPayloadSchema = z.object({
  idempotencyKey,
  creditId: id,
  amountCents: cents.refine((v) => v !== 0, {
    message: 'O ajuste deve ser diferente de zero.',
  }),
  reason,
})

export const statementQuerySchema = z.object({
  recipientId: id.optional(),
  dateFrom: civilDate.optional(),
  dateTo: civilDate.optional(),
  housingComplexId: id.optional(),
  processId: id.optional(),
})

export const reserveQuerySchema = z.object({
  poolKey: z.string().trim().max(120).optional(),
  processId: id.optional(),
})

export const reserveDebitSchema = z.object({
  idempotencyKey,
  poolKey: z.string().trim().min(1).max(120),
  processId: id.nullable().optional(),
  kind: z.enum(['DESPESA', 'TRANSFERENCIA']),
  amountCents: cents.positive({ message: 'O valor deve ser maior que zero.' }),
  movementDate: civilDate,
  description: z
    .string()
    .trim()
    .min(3, { message: 'Informe a origem/justificativa.' })
    .max(500),
  reference: z.string().trim().max(200).optional(),
  destination: z.string().trim().max(200).optional(),
})

export const attachmentOwnerParamSchema = z.object({
  ownerKind: z.enum(['receipt', 'payout', 'reserve']),
  ownerId: id,
})
