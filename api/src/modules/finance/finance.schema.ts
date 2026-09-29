import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import {
  financeConfigOrigins,
  financeCreditStatuses,
  financeReserveMovementKinds,
  financeRuleNatures,
  financeRuleStages,
  financeUniquenessPolicies,
  financeValueTypes,
} from './finance.engine'

// Modulo Pagamentos V3 (migrations 0037 + 0038). Contrato: docs/pagamentos/CONTRATO.md.
// Dinheiro em CENTAVOS (bigint), percentuais em PONTOS BASE (0 permitido; NULL =
// nao configurado), datas civis em `date`, auditoria em timestamptz (UTC).
// FKs sem cascade destrutivo. Imutabilidade, saldos e estados de credito sao
// garantidos tambem por triggers (0038), nao apenas pelo servico.

export const financeRecipientKinds = [
  'PESSOA_FISICA',
  'PESSOA_JURIDICA',
] as const
export const financeRuleStatuses = ['ATIVA', 'REVOGADA'] as const
export const financeReceiptKinds = [
  'HONORARIOS_CONTRATUAIS',
  'SUCUMBENCIA',
  'MULTA',
] as const
export const financeReceiptStatuses = [
  'RASCUNHO',
  'EM_PREVIA',
  'BLOQUEADO',
  'APTO',
  'FECHADO',
  'CANCELADO',
] as const
export const financeClosingStatuses = ['ATIVO', 'ESTORNADO'] as const
export const financeRecordStatuses = ['ATIVO', 'ESTORNADO'] as const
export const financeStepKinds = [
  'RECEITA_TOTAL',
  'PROVISAO_RECEITA',
  'TOTAL_PROVISOES',
  'RECEITA_LIQUIDA',
  'DEDUCAO_LIQUIDA',
  'RESERVA',
  'TOTAL_DEDUCOES',
  'RESULTADO_1',
  'PARTICIPACAO_RESULTADO',
  'RESULTADO_2',
  'DISTRIBUICAO_FINAL',
  'SALDO_FINAL',
] as const

export type FinanceReceiptStatus = (typeof financeReceiptStatuses)[number]
export type FinanceReceiptKind = (typeof financeReceiptKinds)[number]

export const financeRecipientKindEnum = pgEnum(
  'finance_recipient_kind',
  financeRecipientKinds,
)
export const financeConfigOriginEnum = pgEnum(
  'finance_config_origin',
  financeConfigOrigins,
)
export const financeRuleStageEnum = pgEnum(
  'finance_rule_stage',
  financeRuleStages,
)
export const financeRuleNatureEnum = pgEnum(
  'finance_rule_nature',
  financeRuleNatures,
)
export const financeValueTypeEnum = pgEnum(
  'finance_value_type',
  financeValueTypes,
)
export const financeUniquenessEnum = pgEnum(
  'finance_uniqueness',
  financeUniquenessPolicies,
)
export const financeRuleStatusEnum = pgEnum(
  'finance_rule_status',
  financeRuleStatuses,
)
export const financeReceiptKindEnum = pgEnum(
  'finance_receipt_kind',
  financeReceiptKinds,
)
export const financeReceiptStatusEnum = pgEnum(
  'finance_receipt_status',
  financeReceiptStatuses,
)
export const financeClosingStatusEnum = pgEnum(
  'finance_closing_status',
  financeClosingStatuses,
)
export const financeRecordStatusEnum = pgEnum(
  'finance_record_status',
  financeRecordStatuses,
)
export const financeStepKindEnum = pgEnum('finance_step_kind', financeStepKinds)
export const financeCreditStatusEnum = pgEnum(
  'finance_credit_status',
  financeCreditStatuses,
)
export const financeReserveMovementKindEnum = pgEnum(
  'finance_reserve_movement_kind',
  financeReserveMovementKinds,
)

const cents = (name: string) => bigint(name, { mode: 'number' })
const utc = (name: string) => timestamp(name, { withTimezone: true })

// Lote de importacao de configuracao (P04C): gravado SO na confirmacao. As regras
// importadas vivem na mesma estrutura do cadastro manual (INV-10).
export const financeImportBatch = pgTable(
  'finance_import_batch',
  {
    id: text('id').primaryKey(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    mapping: jsonb('mapping').notNull(),
    summary: jsonb('summary').notNull(),
    rows: jsonb('rows').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('finance_import_batch_idempotency_idx').on(
      table.idempotencyKey,
    ),
  ],
)

// Recebedor/colaborador: identidade ESTAVEL (id), separada da conta de login.
export const financeRecipient = pgTable(
  'finance_recipient',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: financeRecipientKindEnum('kind').notNull(),
    document: text('document').default('').notNull(),
    paymentNote: text('payment_note').default('').notNull(),
    notes: text('notes').default('').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').default(true).notNull(),
    origin: financeConfigOriginEnum('origin').default('MANUAL').notNull(),
    importBatchId: text('import_batch_id').references(
      () => financeImportBatch.id,
      { onDelete: 'restrict' },
    ),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    updatedAt: utc('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('finance_recipient_document_idx')
      .on(table.document)
      .where(sql`${table.document} <> ''`),
    index('finance_recipient_name_idx').on(table.name),
    check('finance_recipient_name_chk', sql`btrim(${table.name}) <> ''`),
  ],
)

// Cada linha e uma VERSAO de regra (lineage_id = identidade estavel). Versao ativa
// e imutavel, exceto encerramento da vigencia (valid_to) e revogacao.
export const financeRule = pgTable(
  'finance_rule',
  {
    id: text('id').primaryKey(),
    lineageId: text('lineage_id').notNull(),
    version: integer('version').notNull(),
    stage: financeRuleStageEnum('stage').notNull(),
    nature: financeRuleNatureEnum('nature').notNull(),
    recipientId: text('recipient_id').references(() => financeRecipient.id, {
      onDelete: 'restrict',
    }),
    poolKey: text('pool_key'),
    poolLabel: text('pool_label'),
    workType: text('work_type').default('').notNull(),
    valueType: financeValueTypeEnum('value_type').notNull(),
    basisPoints: integer('basis_points'),
    fixedCents: cents('fixed_cents'),
    sortOrder: integer('sort_order').default(0).notNull(),
    uniqueness: financeUniquenessEnum('uniqueness')
      .default('NENHUMA')
      .notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    origin: financeConfigOriginEnum('origin').default('MANUAL').notNull(),
    importBatchId: text('import_batch_id').references(
      () => financeImportBatch.id,
      { onDelete: 'restrict' },
    ),
    status: financeRuleStatusEnum('status').default('ATIVA').notNull(),
    notes: text('notes').default('').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    revokedAt: utc('revoked_at'),
    revokedByUserId: text('revoked_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    uniqueIndex('finance_rule_lineage_version_idx').on(
      table.lineageId,
      table.version,
    ),
    index('finance_rule_recipient_idx').on(table.recipientId),
    index('finance_rule_status_idx').on(table.status),
    check(
      'finance_rule_validity_chk',
      sql`${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`,
    ),
    check(
      'finance_rule_value_chk',
      sql`(${table.valueType} = 'PERCENTUAL' AND ${table.fixedCents} IS NULL AND (${table.basisPoints} IS NULL OR ${table.basisPoints} BETWEEN 0 AND 10000)) OR (${table.valueType} = 'VALOR_FIXO' AND ${table.basisPoints} IS NULL AND (${table.fixedCents} IS NULL OR ${table.fixedCents} >= 0))`,
    ),
    check(
      'finance_rule_nature_chk',
      sql`(${table.nature} = 'CREDITO' AND ${table.recipientId} IS NOT NULL AND ${table.poolKey} IS NULL) OR (${table.nature} <> 'CREDITO' AND ${table.recipientId} IS NULL AND btrim(coalesce(${table.poolKey}, '')) <> '' AND btrim(coalesce(${table.poolLabel}, '')) <> '')`,
    ),
    check(
      'finance_rule_stage_nature_chk',
      sql`(${table.stage} = 'PROVISAO_RECEITA' AND ${table.nature} = 'PROVISAO') OR (${table.stage} = 'DEDUCAO_LIQUIDA' AND ${table.nature} IN ('CREDITO', 'PROVISAO')) OR (${table.stage} = 'RESERVA' AND ${table.nature} = 'RESERVA') OR (${table.stage} IN ('PARTICIPACAO_RESULTADO', 'DISTRIBUICAO_FINAL') AND ${table.nature} = 'CREDITO')`,
    ),
    check(
      'finance_rule_final_percent_chk',
      sql`${table.stage} <> 'DISTRIBUICAO_FINAL' OR ${table.valueType} = 'PERCENTUAL'`,
    ),
    check(
      'finance_rule_uniqueness_chk',
      sql`${table.uniqueness} = 'NENHUMA' OR ${table.stage} = 'RESERVA'`,
    ),
    check('finance_rule_order_chk', sql`${table.sortOrder} >= 0`),
    check('finance_rule_version_chk', sql`${table.version} >= 1`),
    check(
      'finance_rule_revoked_chk',
      sql`${table.status} = 'ATIVA' OR (${table.revokedAt} IS NOT NULL AND btrim(coalesce(${table.revokeReason}, '')) <> '')`,
    ),
  ],
)

// Condominios de cada VERSAO (INV-03). Imutavel (trigger).
export const financeRuleHousingComplex = pgTable(
  'finance_rule_housing_complex',
  {
    ruleId: text('rule_id')
      .notNull()
      .references(() => financeRule.id, { onDelete: 'restrict' }),
    housingComplexId: text('housing_complex_id')
      .notNull()
      .references(() => housingComplex.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.ruleId, table.housingComplexId] }),
    index('finance_rule_hc_complex_idx').on(table.housingComplexId),
  ],
)

export const financeReceipt = pgTable(
  'finance_receipt',
  {
    id: text('id').primaryKey(),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'restrict' }),
    kind: financeReceiptKindEnum('kind').notNull(),
    amountCents: cents('amount_cents').notNull(),
    status: financeReceiptStatusEnum('status').default('RASCUNHO').notNull(),
    releaseDate: date('release_date'),
    reference: text('reference').default('').notNull(),
    originDescription: text('origin_description').default('').notNull(),
    description: text('description').default('').notNull(),
    // Data de cadastro do cliente (civil, America/Sao_Paulo) preservada: seleciona
    // a vigencia das regras (INV-02).
    clientRegistrationDate: date('client_registration_date'),
    lastCalculation: jsonb('last_calculation'),
    lastCalculationHash: text('last_calculation_hash'),
    lastCalculatedAt: utc('last_calculated_at'),
    approvedCalculationHash: text('approved_calculation_hash'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    version: integer('version').default(1).notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    updatedAt: utc('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    approvedAt: utc('approved_at'),
    cancelledByUserId: text('cancelled_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    cancelledAt: utc('cancelled_at'),
    cancelReason: text('cancel_reason'),
  },
  (table) => [
    uniqueIndex('finance_receipt_idempotency_idx').on(table.idempotencyKey),
    index('finance_receipt_process_idx').on(table.processId),
    index('finance_receipt_status_idx').on(table.status),
    index('finance_receipt_release_date_idx').on(table.releaseDate),
    check('finance_receipt_amount_chk', sql`${table.amountCents} > 0`),
    check(
      'finance_receipt_release_chk',
      sql`${table.status} NOT IN ('EM_PREVIA', 'APTO', 'FECHADO') OR ${table.releaseDate} IS NOT NULL`,
    ),
    check(
      'finance_receipt_calculated_chk',
      sql`${table.status} NOT IN ('EM_PREVIA', 'BLOQUEADO', 'APTO', 'FECHADO') OR ${table.lastCalculation} IS NOT NULL`,
    ),
    check(
      'finance_receipt_approved_chk',
      sql`${table.status} NOT IN ('APTO', 'FECHADO') OR (${table.approvedAt} IS NOT NULL AND ${table.approvedCalculationHash} IS NOT NULL)`,
    ),
    check(
      'finance_receipt_cancel_chk',
      sql`${table.status} <> 'CANCELADO' OR (${table.cancelledAt} IS NOT NULL AND btrim(coalesce(${table.cancelReason}, '')) <> '')`,
    ),
  ],
)

// Fechamento em lote: snapshot imutavel (trigger) das entradas, versoes e memoria.
export const financeClosing = pgTable(
  'finance_closing',
  {
    id: text('id').primaryKey(),
    code: text('code')
      .notNull()
      .default(
        sql`('FEC-' || lpad(nextval('finance_closing_code_seq')::text, 6, '0'))`,
      ),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: financeClosingStatusEnum('status').default('ATIVO').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    inputHash: text('input_hash').notNull(),
    rulesSnapshot: jsonb('rules_snapshot').notNull(),
    totals: jsonb('totals').notNull(),
    receiptCount: integer('receipt_count').notNull(),
    grossCents: cents('gross_cents').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    notes: text('notes').default('').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    reversedByUserId: text('reversed_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    reversedAt: utc('reversed_at'),
    reversalReason: text('reversal_reason'),
  },
  (table) => [
    uniqueIndex('finance_closing_code_idx').on(table.code),
    uniqueIndex('finance_closing_idempotency_idx').on(table.idempotencyKey),
    index('finance_closing_status_idx').on(table.status),
    check(
      'finance_closing_period_chk',
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    check('finance_closing_count_chk', sql`${table.receiptCount} > 0`),
    check(
      'finance_closing_reversal_chk',
      sql`${table.status} = 'ATIVO' OR (${table.reversedAt} IS NOT NULL AND btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
  ],
)

export const financeClosingItem = pgTable(
  'finance_closing_item',
  {
    id: text('id').primaryKey(),
    closingId: text('closing_id')
      .notNull()
      .references(() => financeClosing.id, { onDelete: 'restrict' }),
    receiptId: text('receipt_id')
      .notNull()
      .references(() => financeReceipt.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').default(true).notNull(),
    receiptSnapshot: jsonb('receipt_snapshot').notNull(),
    calculation: jsonb('calculation').notNull(),
    calculationHash: text('calculation_hash').notNull(),
    createdAt: utc('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('finance_closing_item_closing_receipt_idx').on(
      table.closingId,
      table.receiptId,
    ),
    // Um recebimento nunca integra dois fechamentos ATIVOS.
    uniqueIndex('finance_closing_item_active_receipt_idx')
      .on(table.receiptId)
      .where(sql`${table.isActive}`),
  ],
)

// Passos da memoria congelados no fechamento (um por etapa A..P). Imutavel.
export const financeClosingLine = pgTable(
  'finance_closing_line',
  {
    id: text('id').primaryKey(),
    closingId: text('closing_id')
      .notNull()
      .references(() => financeClosing.id, { onDelete: 'restrict' }),
    closingItemId: text('closing_item_id')
      .notNull()
      .references(() => financeClosingItem.id, { onDelete: 'restrict' }),
    receiptId: text('receipt_id')
      .notNull()
      .references(() => financeReceipt.id, { onDelete: 'restrict' }),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'restrict' }),
    housingComplexId: text('housing_complex_id').references(
      () => housingComplex.id,
      { onDelete: 'restrict' },
    ),
    releaseDate: date('release_date').notNull(),
    stepOrder: integer('step_order').notNull(),
    code: text('code').notNull(),
    kind: financeStepKindEnum('kind').notNull(),
    description: text('description').notNull(),
    baseKey: text('base_key'),
    baseCents: cents('base_cents'),
    ruleId: text('rule_id').references(() => financeRule.id, {
      onDelete: 'restrict',
    }),
    ruleLineageId: text('rule_lineage_id'),
    ruleVersion: integer('rule_version'),
    valueType: financeValueTypeEnum('value_type'),
    basisPoints: integer('basis_points'),
    fixedCents: cents('fixed_cents'),
    formula: text('formula').notNull(),
    exactCents: text('exact_cents'),
    rounding: text('rounding').notNull(),
    amountCents: cents('amount_cents').notNull(),
    nature: financeRuleNatureEnum('nature'),
    recipientId: text('recipient_id').references(() => financeRecipient.id, {
      onDelete: 'restrict',
    }),
    poolKey: text('pool_key'),
    poolLabel: text('pool_label'),
    workType: text('work_type'),
    isAllocation: boolean('is_allocation').notNull(),
    note: text('note'),
  },
  (table) => [
    uniqueIndex('finance_closing_line_item_order_idx').on(
      table.closingItemId,
      table.stepOrder,
    ),
    index('finance_closing_line_closing_idx').on(table.closingId),
    index('finance_closing_line_recipient_idx').on(table.recipientId),
    index('finance_closing_line_process_idx').on(table.processId),
  ],
)

// Credito = valor que alguem TEM A RECEBER (nao e pagamento). paid/adjusted/status
// sao mantidos por trigger a partir das baixas e ajustes (fonte de verdade).
export const financeCredit = pgTable(
  'finance_credit',
  {
    id: text('id').primaryKey(),
    closingId: text('closing_id')
      .notNull()
      .references(() => financeClosing.id, { onDelete: 'restrict' }),
    closingLineId: text('closing_line_id')
      .notNull()
      .references(() => financeClosingLine.id, { onDelete: 'restrict' }),
    receiptId: text('receipt_id')
      .notNull()
      .references(() => financeReceipt.id, { onDelete: 'restrict' }),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'restrict' }),
    housingComplexId: text('housing_complex_id').references(
      () => housingComplex.id,
      { onDelete: 'restrict' },
    ),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => financeRecipient.id, { onDelete: 'restrict' }),
    amountCents: cents('amount_cents').notNull(),
    adjustedCents: cents('adjusted_cents').default(0).notNull(),
    paidCents: cents('paid_cents').default(0).notNull(),
    status: financeCreditStatusEnum('status').default('ABERTO').notNull(),
    createdAt: utc('created_at').defaultNow().notNull(),
    updatedAt: utc('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('finance_credit_line_idx').on(table.closingLineId),
    index('finance_credit_recipient_idx').on(table.recipientId),
    index('finance_credit_closing_idx').on(table.closingId),
    index('finance_credit_process_idx').on(table.processId),
    check('finance_credit_amount_chk', sql`${table.amountCents} > 0`),
    check(
      'finance_credit_paid_chk',
      sql`${table.paidCents} >= 0 AND ${table.paidCents} <= ${table.amountCents} + ${table.adjustedCents}`,
    ),
    check(
      'finance_credit_due_chk',
      sql`${table.amountCents} + ${table.adjustedCents} >= 0`,
    ),
  ],
)

// Baixa = pagamento feito FORA da plataforma e apenas registrado aqui.
export const financePayout = pgTable(
  'finance_payout',
  {
    id: text('id').primaryKey(),
    creditId: text('credit_id')
      .notNull()
      .references(() => financeCredit.id, { onDelete: 'restrict' }),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => financeRecipient.id, { onDelete: 'restrict' }),
    amountCents: cents('amount_cents').notNull(),
    paidOn: date('paid_on').notNull(),
    reference: text('reference').notNull(),
    notes: text('notes').default('').notNull(),
    // saldo do credito apos esta baixa (preenchido pelo trigger)
    balanceAfterCents: cents('balance_after_cents').notNull(),
    status: financeRecordStatusEnum('status').default('ATIVO').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    reversedByUserId: text('reversed_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    reversedAt: utc('reversed_at'),
    reversalReason: text('reversal_reason'),
  },
  (table) => [
    uniqueIndex('finance_payout_idempotency_idx').on(table.idempotencyKey),
    index('finance_payout_credit_idx').on(table.creditId),
    index('finance_payout_recipient_idx').on(table.recipientId),
    index('finance_payout_paid_on_idx').on(table.paidOn),
    check('finance_payout_amount_chk', sql`${table.amountCents} > 0`),
    check('finance_payout_reference_chk', sql`btrim(${table.reference}) <> ''`),
    check(
      'finance_payout_reversal_chk',
      sql`${table.status} = 'ATIVO' OR (${table.reversedAt} IS NOT NULL AND btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
  ],
)

// Ajuste = evento corretivo no valor devido de um credito (positivo ou negativo).
// Imutavel; corrigido por outro ajuste.
export const financeAdjustment = pgTable(
  'finance_adjustment',
  {
    id: text('id').primaryKey(),
    creditId: text('credit_id')
      .notNull()
      .references(() => financeCredit.id, { onDelete: 'restrict' }),
    amountCents: cents('amount_cents').notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('finance_adjustment_idempotency_idx').on(table.idempotencyKey),
    index('finance_adjustment_credit_idx').on(table.creditId),
    check('finance_adjustment_amount_chk', sql`${table.amountCents} <> 0`),
    check('finance_adjustment_reason_chk', sql`btrim(${table.reason}) <> ''`),
  ],
)

// Livro de reservas/provisoes. A reserva (pool) vem da regra; saldo global e por
// processo nunca negativo (trigger). Reserva unica: indice unico parcial.
export const financeReserveMovement = pgTable(
  'finance_reserve_movement',
  {
    id: text('id').primaryKey(),
    poolKey: text('pool_key').notNull(),
    poolLabel: text('pool_label').notNull(),
    nature: financeRuleNatureEnum('nature').notNull(),
    kind: financeReserveMovementKindEnum('kind').notNull(),
    uniquePerProcess: boolean('unique_per_process').default(false).notNull(),
    amountCents: cents('amount_cents').notNull(),
    processId: text('process_id').references(() => process.id, {
      onDelete: 'restrict',
    }),
    closingId: text('closing_id').references(() => financeClosing.id, {
      onDelete: 'restrict',
    }),
    receiptId: text('receipt_id').references(() => financeReceipt.id, {
      onDelete: 'restrict',
    }),
    closingLineId: text('closing_line_id').references(
      () => financeClosingLine.id,
      { onDelete: 'restrict' },
    ),
    movementDate: date('movement_date').notNull(),
    reference: text('reference').default('').notNull(),
    description: text('description').default('').notNull(),
    destination: text('destination').default('').notNull(),
    status: financeRecordStatusEnum('status').default('ATIVO').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    reversedByUserId: text('reversed_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    reversedAt: utc('reversed_at'),
    reversalReason: text('reversal_reason'),
  },
  (table) => [
    uniqueIndex('finance_reserve_movement_idempotency_idx').on(
      table.idempotencyKey,
    ),
    uniqueIndex('finance_reserve_unique_constitution_idx')
      .on(table.poolKey, table.processId)
      .where(
        sql`${table.kind} = 'CONSTITUICAO' AND ${table.status} = 'ATIVO' AND ${table.uniquePerProcess}`,
      ),
    index('finance_reserve_movement_pool_idx').on(table.poolKey),
    index('finance_reserve_movement_process_idx').on(table.processId),
    index('finance_reserve_movement_closing_idx').on(table.closingId),
    check('finance_reserve_movement_amount_chk', sql`${table.amountCents} > 0`),
    check(
      'finance_reserve_movement_nature_chk',
      sql`${table.nature} IN ('PROVISAO', 'RESERVA')`,
    ),
    check(
      'finance_reserve_movement_constitution_chk',
      sql`${table.kind} <> 'CONSTITUICAO' OR (${table.closingId} IS NOT NULL AND ${table.receiptId} IS NOT NULL AND ${table.processId} IS NOT NULL AND ${table.closingLineId} IS NOT NULL)`,
    ),
    check(
      'finance_reserve_movement_origin_chk',
      sql`${table.kind} = 'CONSTITUICAO' OR btrim(${table.description}) <> ''`,
    ),
    check(
      'finance_reserve_movement_unique_chk',
      sql`NOT ${table.uniquePerProcess} OR ${table.processId} IS NOT NULL`,
    ),
    check(
      'finance_reserve_movement_reversal_chk',
      sql`${table.status} = 'ATIVO' OR (${table.reversedAt} IS NOT NULL AND btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
  ],
)

// Comprovantes privados (sem URL publica; download so pela API autorizada).
export const financeAttachment = pgTable(
  'finance_attachment',
  {
    id: text('id').primaryKey(),
    receiptId: text('receipt_id').references(() => financeReceipt.id, {
      onDelete: 'restrict',
    }),
    payoutId: text('payout_id').references(() => financePayout.id, {
      onDelete: 'restrict',
    }),
    reserveMovementId: text('reserve_movement_id').references(
      () => financeReserveMovement.id,
      { onDelete: 'restrict' },
    ),
    bucketName: text('bucket_name').notNull(),
    objectKey: text('object_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeInBytes: integer('size_in_bytes').notNull(),
    sha256: text('sha256').notNull(),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    uploadedAt: utc('uploaded_at').defaultNow().notNull(),
    removedAt: utc('removed_at'),
    removedByUserId: text('removed_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    removeReason: text('remove_reason'),
  },
  (table) => [
    uniqueIndex('finance_attachment_object_idx').on(
      table.bucketName,
      table.objectKey,
    ),
    index('finance_attachment_receipt_idx').on(table.receiptId),
    index('finance_attachment_payout_idx').on(table.payoutId),
    index('finance_attachment_reserve_idx').on(table.reserveMovementId),
    check(
      'finance_attachment_owner_chk',
      sql`num_nonnulls(${table.receiptId}, ${table.payoutId}, ${table.reserveMovementId}) = 1`,
    ),
  ],
)

// Log de auditoria append-only (trigger bloqueia UPDATE/DELETE). Mantido da 0037.
export const financeAuditLog = pgTable(
  'finance_audit_log',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    createdAt: utc('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('finance_audit_log_entity_idx').on(table.entityType, table.entityId),
    index('finance_audit_log_created_at_idx').on(table.createdAt),
  ],
)
