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
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { process } from '../processes/processes.schema'
import {
  financeLineRubrics,
  financeReserveMovementKinds,
  financeReservePools,
  financeRuleRoles,
} from './finance.engine'

// Modulo Pagamentos. Contrato: docs/pagamentos/CONTRATO.md.
// Dinheiro em CENTAVOS (bigint), percentuais em PONTOS BASE, datas civis em `date`,
// auditoria em timestamptz (UTC). FKs SEM cascade destrutivo: registro financeiro
// nunca some junto com o processo/usuario. Imutabilidade de snapshots e do log de
// auditoria garantida por triggers na migration 0037.

export const financeRecipientKinds = [
  'PESSOA_FISICA',
  'PESSOA_JURIDICA',
] as const
export const financeRuleStatuses = [
  'RASCUNHO',
  'PUBLICADA',
  'REVOGADA',
] as const
export const financeReceiptKinds = [
  'HONORARIOS_CONTRATUAIS',
  'SUCUMBENCIA',
  'MULTA',
] as const
export const financeReceiptStatuses = [
  'PREVISTO',
  'LIBERADO',
  'CONFERIDO',
  'FECHADO',
  'CANCELADO',
] as const
export const financeReferenceDateSources = [
  'CADASTRO_PROCESSO',
  'INFORMADA',
] as const
export const financeClosingStatuses = ['ATIVO', 'ESTORNADO'] as const
export const financeRecordStatuses = ['ATIVO', 'ESTORNADO'] as const

export type FinanceReceiptStatus = (typeof financeReceiptStatuses)[number]
export type FinanceReceiptKind = (typeof financeReceiptKinds)[number]
export type FinanceRuleStatus = (typeof financeRuleStatuses)[number]

export const financeRecipientKindEnum = pgEnum(
  'finance_recipient_kind',
  financeRecipientKinds,
)
export const financeRuleRoleEnum = pgEnum('finance_rule_role', financeRuleRoles)
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
export const financeReferenceDateSourceEnum = pgEnum(
  'finance_reference_date_source',
  financeReferenceDateSources,
)
export const financeClosingStatusEnum = pgEnum(
  'finance_closing_status',
  financeClosingStatuses,
)
export const financeRecordStatusEnum = pgEnum(
  'finance_record_status',
  financeRecordStatuses,
)
export const financeLineRubricEnum = pgEnum(
  'finance_line_rubric',
  financeLineRubrics,
)
export const financeReservePoolEnum = pgEnum(
  'finance_reserve_pool',
  financeReservePools,
)
export const financeReserveMovementKindEnum = pgEnum(
  'finance_reserve_movement_kind',
  financeReserveMovementKinds,
)

const cents = (name: string) => bigint(name, { mode: 'number' })
const utc = (name: string) => timestamp(name, { withTimezone: true })

// Destinatario financeiro: identidade ESTAVEL (id), separada da conta de login.
// Nomes nao sao unicos nem usados para unir pessoas.
export const financeRecipient = pgTable(
  'finance_recipient',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: financeRecipientKindEnum('kind').notNull(),
    // CPF/CNPJ so digitos; '' quando nao informado.
    document: text('document').default('').notNull(),
    paymentNote: text('payment_note').default('').notNull(),
    notes: text('notes').default('').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').default(true).notNull(),
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

// Regra versionada de participacao/distribuicao. Publicada = imutavel (exceto
// revogacao). Alteracao = nova regra com supersedes_rule_id + revision+1.
export const financeRule = pgTable(
  'finance_rule',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => financeRecipient.id, { onDelete: 'restrict' }),
    role: financeRuleRoleEnum('role').notNull(),
    housingComplexId: text('housing_complex_id').references(
      () => housingComplex.id,
      { onDelete: 'restrict' },
    ),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    basisPoints: integer('basis_points'),
    cascadeOrder: integer('cascade_order'),
    status: financeRuleStatusEnum('status').default('RASCUNHO').notNull(),
    revision: integer('revision').default(1).notNull(),
    supersedesRuleId: text('supersedes_rule_id'),
    notes: text('notes').default('').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    updatedAt: utc('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    publishedAt: utc('published_at'),
    publishedByUserId: text('published_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    revokedAt: utc('revoked_at'),
    revokedByUserId: text('revoked_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    index('finance_rule_recipient_idx').on(table.recipientId),
    index('finance_rule_status_idx').on(table.status),
    index('finance_rule_housing_complex_idx').on(table.housingComplexId),
    check(
      'finance_rule_validity_chk',
      sql`${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`,
    ),
    check(
      'finance_rule_bps_chk',
      sql`(${table.role} = 'DISTRIBUICAO_SALDO' AND ${table.basisPoints} IS NULL) OR (${table.role} <> 'DISTRIBUICAO_SALDO' AND ${table.basisPoints} BETWEEN 1 AND 10000)`,
    ),
    check(
      'finance_rule_order_chk',
      sql`(${table.role} = 'DISTRIBUICAO' AND ${table.cascadeOrder} >= 1) OR (${table.role} <> 'DISTRIBUICAO' AND ${table.cascadeOrder} IS NULL)`,
    ),
    check(
      'finance_rule_published_chk',
      sql`${table.status} = 'RASCUNHO' OR ${table.publishedAt} IS NOT NULL`,
    ),
    check(
      'finance_rule_revoked_chk',
      sql`${table.status} <> 'REVOGADA' OR (${table.revokedAt} IS NOT NULL AND btrim(coalesce(${table.revokeReason}, '')) <> '')`,
    ),
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
    status: financeReceiptStatusEnum('status').default('PREVISTO').notNull(),
    // Data civil em que o valor foi liberado na conta indicada.
    releaseDate: date('release_date'),
    reference: text('reference').default('').notNull(),
    description: text('description').default('').notNull(),
    // Data de cadastro de referencia usada nas participacoes (preservada).
    referenceDate: date('reference_date').notNull(),
    referenceDateSource: financeReferenceDateSourceEnum(
      'reference_date_source',
    ).notNull(),
    referenceDateAmbiguous: boolean('reference_date_ambiguous')
      .default(false)
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    version: integer('version').default(1).notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: utc('created_at').defaultNow().notNull(),
    updatedAt: utc('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    verifiedByUserId: text('verified_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    verifiedAt: utc('verified_at'),
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
      sql`${table.status} IN ('PREVISTO', 'CANCELADO') OR ${table.releaseDate} IS NOT NULL`,
    ),
    check(
      'finance_receipt_verified_chk',
      sql`${table.status} NOT IN ('CONFERIDO', 'FECHADO') OR ${table.verifiedAt} IS NOT NULL`,
    ),
    check(
      'finance_receipt_cancel_chk',
      sql`${table.status} <> 'CANCELADO' OR (${table.cancelledAt} IS NOT NULL AND btrim(coalesce(${table.cancelReason}, '')) <> '')`,
    ),
  ],
)

// Fechamento em lote: snapshot imutavel (trigger) das entradas, regras e linhas.
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
    configSnapshot: jsonb('config_snapshot').notNull(),
    totals: jsonb('totals').notNull(),
    receiptCount: integer('receipt_count').notNull(),
    grossCents: cents('gross_cents').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
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
    // false quando o fechamento e estornado (unica mudanca permitida pelo trigger).
    isActive: boolean('is_active').default(true).notNull(),
    receiptSnapshot: jsonb('receipt_snapshot').notNull(),
    calculation: jsonb('calculation').notNull(),
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
    sequence: integer('sequence').notNull(),
    rubric: financeLineRubricEnum('rubric').notNull(),
    recipientId: text('recipient_id').references(() => financeRecipient.id, {
      onDelete: 'restrict',
    }),
    ruleId: text('rule_id').references(() => financeRule.id, {
      onDelete: 'restrict',
    }),
    ruleRevision: integer('rule_revision'),
    basisPoints: integer('basis_points'),
    basisCents: cents('basis_cents').notNull(),
    amountCents: cents('amount_cents').notNull(),
    description: text('description').notNull(),
  },
  (table) => [
    uniqueIndex('finance_closing_line_item_seq_idx').on(
      table.closingItemId,
      table.sequence,
    ),
    index('finance_closing_line_closing_idx').on(table.closingId),
    index('finance_closing_line_recipient_idx').on(table.recipientId),
    index('finance_closing_line_process_idx').on(table.processId),
    check('finance_closing_line_amount_chk', sql`${table.amountCents} >= 0`),
  ],
)

// Baixa = pagamento feito FORA da plataforma e apenas registrado aqui.
export const financePayout = pgTable(
  'finance_payout',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => financeRecipient.id, { onDelete: 'restrict' }),
    amountCents: cents('amount_cents').notNull(),
    paidOn: date('paid_on').notNull(),
    reference: text('reference').notNull(),
    notes: text('notes').default('').notNull(),
    status: financeRecordStatusEnum('status').default('ATIVO').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
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
    index('finance_payout_recipient_idx').on(table.recipientId),
    check('finance_payout_amount_chk', sql`${table.amountCents} > 0`),
    check('finance_payout_reference_chk', sql`btrim(${table.reference}) <> ''`),
    check(
      'finance_payout_reversal_chk',
      sql`${table.status} = 'ATIVO' OR (${table.reversedAt} IS NOT NULL AND btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
  ],
)

export const financePayoutAllocation = pgTable(
  'finance_payout_allocation',
  {
    id: text('id').primaryKey(),
    payoutId: text('payout_id')
      .notNull()
      .references(() => financePayout.id, { onDelete: 'restrict' }),
    closingLineId: text('closing_line_id')
      .notNull()
      .references(() => financeClosingLine.id, { onDelete: 'restrict' }),
    amountCents: cents('amount_cents').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    uniqueIndex('finance_payout_allocation_payout_line_idx').on(
      table.payoutId,
      table.closingLineId,
    ),
    index('finance_payout_allocation_line_idx').on(table.closingLineId),
    check(
      'finance_payout_allocation_amount_chk',
      sql`${table.amountCents} > 0`,
    ),
  ],
)

// Livro de reservas/provisoes (certidao por processo, tributo por fechamento,
// apoio global). Saldo nunca negativo (servico com trava + trigger).
export const financeReserveMovement = pgTable(
  'finance_reserve_movement',
  {
    id: text('id').primaryKey(),
    pool: financeReservePoolEnum('pool').notNull(),
    kind: financeReserveMovementKindEnum('kind').notNull(),
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
    movementDate: date('movement_date').notNull(),
    reference: text('reference').default('').notNull(),
    description: text('description').default('').notNull(),
    destination: text('destination').default('').notNull(),
    status: financeRecordStatusEnum('status').default('ATIVO').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
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
    // Reserva de certidao: no maximo UMA constituicao ativa por processo.
    uniqueIndex('finance_reserve_certidao_once_idx')
      .on(table.processId)
      .where(
        sql`${table.pool} = 'CERTIDAO' AND ${table.kind} = 'CONSTITUICAO' AND ${table.status} = 'ATIVO'`,
      ),
    index('finance_reserve_movement_pool_idx').on(table.pool),
    index('finance_reserve_movement_process_idx').on(table.processId),
    index('finance_reserve_movement_closing_idx').on(table.closingId),
    check('finance_reserve_movement_amount_chk', sql`${table.amountCents} > 0`),
    check(
      'finance_reserve_movement_scope_chk',
      sql`(${table.pool} <> 'CERTIDAO' OR ${table.processId} IS NOT NULL) AND (${table.pool} <> 'TRIBUTO' OR ${table.closingId} IS NOT NULL)`,
    ),
    check(
      'finance_reserve_movement_constitution_chk',
      sql`${table.kind} <> 'CONSTITUICAO' OR (${table.closingId} IS NOT NULL AND ${table.receiptId} IS NOT NULL)`,
    ),
    check(
      'finance_reserve_movement_reversal_chk',
      sql`${table.status} = 'ATIVO' OR (${table.reversedAt} IS NOT NULL AND btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
  ],
)

// Comprovantes privados (bucket sem acesso publico; download so via API
// autorizada). Exatamente um dono. Remocao logica.
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

// Log de auditoria append-only (trigger bloqueia UPDATE/DELETE).
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
