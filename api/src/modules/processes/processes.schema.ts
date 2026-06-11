import { relations } from 'drizzle-orm'
import {
  boolean,
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
import {
  processDocumentStatuses,
  processHistoryEventTypes,
  processStatuses,
} from './processes.status'

export const processStatusEnum = pgEnum('process_status', processStatuses)

export const processHistoryEventTypeEnum = pgEnum(
  'process_history_event_type',
  processHistoryEventTypes,
)

export const processDocumentStatusEnum = pgEnum(
  'process_document_status',
  processDocumentStatuses,
)

export type ProcessHistoryChangedFields = Record<
  string,
  { before: unknown; after: unknown }
>

// Contexto estruturado de um evento de historico (generico). Ex.: link para a
// evidencia de IA (aiAnalysisId) + o que a decisao automatica mudou.
export type ProcessHistoryMetadata = {
  aiAnalysisId?: string
  fromOwnerType?: string
  toOwnerType?: string
  matchedBy?: 'cpf' | 'name' | 'name+city' | 'none'
  fromHousingComplex?: string
  toHousingComplex?: string
}

export const process = pgTable(
  'process',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    status: processStatusEnum('status').default('CADASTRADO').notNull(),
    fullName: text('full_name').notNull(),
    birthDate: date('birth_date'),
    nationality: text('nationality').notNull(),
    maritalStatus: text('marital_status').notNull(),
    profession: text('profession').notNull(),
    ownerType: text('owner_type').notNull(),
    // Origem do ownerType: 'human' (definido na mao) | 'system' (auto-aplicado
    // pela analise do contrato Caixa). Habilita human-lock + proveniencia.
    ownerTypeSource: text('owner_type_source').default('human').notNull(),
    // Estado operacional (NAO evidencia) da analise do contrato Caixa:
    // idle | processing | done | review | error. Orfao ('processing' apos crash)
    // volta a ser reivindicavel por staleness no claim (caixa_analysis_started_at);
    // NAO ha reset no boot.
    caixaAnalysisStatus: text('caixa_analysis_status')
      .default('idle')
      .notNull(),
    // Heartbeat do job de analise: setado SO no claim. Base do staleness (NAO usar
    // updated_at, que e tocado por qualquer edicao do processo).
    caixaAnalysisStartedAt: timestamp('caixa_analysis_started_at'),
    // Consulta automatica do termo de quitacao no portal da Caixa (worker RPA):
    // idle | pending | processing | quitado | nao_encontrado | erro.
    caixaQuitacaoStatus: text('caixa_quitacao_status')
      .default('idle')
      .notNull(),
    caixaQuitacaoMessage: text('caixa_quitacao_message'),
    caixaQuitacaoCheckedAt: timestamp('caixa_quitacao_checked_at'),
    // Heartbeat do job de quitacao: setado SO no claim. Base do staleness.
    caixaQuitacaoStartedAt: timestamp('caixa_quitacao_started_at'),
    caixaQuitacaoAttempts: integer('caixa_quitacao_attempts')
      .default(0)
      .notNull(),
    cpf: text('cpf').notNull(),
    rg: text('rg').notNull(),
    cadunico: text('cadunico').notNull(),
    propertyPaidOff: text('property_paid_off').notNull(),
    deliveredMoreThanTenYears: text('delivered_more_than_ten_years'),
    purchaseAgreementLessThanTenYears: text(
      'purchase_agreement_less_than_ten_years',
    ),
    state: text('state').notNull(),
    city: text('city').notNull(),
    district: text('district').notNull(),
    housingComplex: text('housing_complex').notNull(),
    // Origem do housingComplex: 'human' (escolhido na mao) | 'system' (auto-
    // aplicado pela analise da procuracao). Habilita human-lock + proveniencia
    // (espelha ownerTypeSource).
    housingComplexSource: text('housing_complex_source')
      .default('human')
      .notNull(),
    // Estado operacional da analise da procuracao (conjunto a partir do endereco
    // do outorgante): idle | processing | done | review | error. Orfao
    // ('processing' apos crash) e reivindicavel por staleness no claim (heartbeat
    // abaixo); NAO ha reset no boot.
    procuracaoConjuntoStatus: text('procuracao_conjunto_status')
      .default('idle')
      .notNull(),
    // Heartbeat do job: setado SO no claim. Base do staleness.
    procuracaoConjuntoStartedAt: timestamp('procuracao_conjunto_started_at'),
    street: text('street').notNull(),
    number: text('number').notNull(),
    complement: text('complement').notNull(),
    zipcode: text('zipcode').notNull(),
    email: text('email').notNull(),
    whatsapp: text('whatsapp').notNull(),
    spouseContractSigned: text('spouse_contract_signed'),
    spouseFullName: text('spouse_full_name'),
    spouseBirthDate: date('spouse_birth_date'),
    spouseNationality: text('spouse_nationality'),
    spouseMaritalStatus: text('spouse_marital_status'),
    spouseProfession: text('spouse_profession'),
    spouseCpf: text('spouse_cpf'),
    spouseRg: text('spouse_rg'),
    spouseCadunico: text('spouse_cadunico'),
    spouseSameAddress: text('spouse_same_address'),
    spouseState: text('spouse_state'),
    spouseCity: text('spouse_city'),
    spouseDistrict: text('spouse_district'),
    spouseHousingComplex: text('spouse_housing_complex'),
    spouseStreet: text('spouse_street'),
    spouseNumber: text('spouse_number'),
    spouseComplement: text('spouse_complement'),
    spouseZipcode: text('spouse_zipcode'),
    witness1Id: text('witness_1_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    witness2Id: text('witness_2_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    observation: text('observation').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    assignedAttorneyId: text('assigned_attorney_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    legalProcessNumber: text('legal_process_number'),
    causeValue: text('cause_value'),
    protocolDate: date('protocol_date'),
    documentationReadyAt: timestamp('documentation_ready_at'),
    startedAt: timestamp('started_at'),
    finalizedAt: timestamp('finalized_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    housingComplexId: text('housing_complex_id').references(
      () => housingComplex.id,
      { onDelete: 'restrict' },
    ),
    documentationAssigneeId: text('documentation_assignee_id').references(
      () => user.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('process_status_idx').on(table.status),
    index('process_created_by_user_id_idx').on(table.createdByUserId),
    index('process_assigned_attorney_id_idx').on(table.assignedAttorneyId),
    index('process_witness_1_id_idx').on(table.witness1Id),
    index('process_witness_2_id_idx').on(table.witness2Id),
    index('process_housing_complex_id_idx').on(table.housingComplexId),
    index('process_documentation_assignee_id_idx').on(
      table.documentationAssigneeId,
    ),
  ],
)

export const processHistory = pgTable(
  'process_history',
  {
    id: text('id').primaryKey(),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    eventType: processHistoryEventTypeEnum('event_type').notNull(),
    fromStatus: processStatusEnum('from_status'),
    toStatus: processStatusEnum('to_status'),
    changedFields: jsonb(
      'changed_fields',
    ).$type<ProcessHistoryChangedFields | null>(),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<ProcessHistoryMetadata | null>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('process_history_process_id_idx').on(table.processId),
    index('process_history_actor_user_id_idx').on(table.actorUserId),
    index('process_history_event_type_idx').on(table.eventType),
  ],
)

export const processDocumentType = pgTable(
  'process_document_type',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull(),
    isRequired: boolean('is_required').default(true).notNull(),
    allowsMultipleFiles: boolean('allows_multiple_files')
      .default(false)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('process_document_type_key_idx').on(table.key),
    index('process_document_type_sort_order_idx').on(table.sortOrder),
    index('process_document_type_is_active_idx').on(table.isActive),
  ],
)

export const processDocument = pgTable(
  'process_document',
  {
    id: text('id').primaryKey(),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'cascade' }),
    documentTypeId: text('document_type_id')
      .notNull()
      .references(() => processDocumentType.id, { onDelete: 'restrict' }),
    status: processDocumentStatusEnum('status').default('PENDENTE').notNull(),
    observation: text('observation').default('').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('process_document_process_type_idx').on(
      table.processId,
      table.documentTypeId,
    ),
    index('process_document_status_idx').on(table.status),
    index('process_document_process_id_idx').on(table.processId),
    index('process_document_document_type_id_idx').on(table.documentTypeId),
  ],
)

export const processDocumentFile = pgTable(
  'process_document_file',
  {
    id: text('id').primaryKey(),
    processDocumentId: text('process_document_id')
      .notNull()
      .references(() => processDocument.id, { onDelete: 'cascade' }),
    bucketName: text('bucket_name').notNull(),
    objectKey: text('object_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeInBytes: integer('size_in_bytes').notNull(),
    revision: integer('revision').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    replacedAt: timestamp('replaced_at'),
  },
  (table) => [
    uniqueIndex('process_document_file_storage_object_idx').on(
      table.bucketName,
      table.objectKey,
    ),
    uniqueIndex('process_document_file_revision_idx').on(
      table.processDocumentId,
      table.revision,
    ),
    index('process_document_file_process_document_id_idx').on(
      table.processDocumentId,
    ),
    index('process_document_file_uploaded_by_user_id_idx').on(
      table.uploadedByUserId,
    ),
    index('process_document_file_is_current_idx').on(table.isCurrent),
  ],
)

export const processGeneratedDocument = pgTable(
  'process_generated_document',
  {
    id: text('id').primaryKey(),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'cascade' }),
    modelKey: text('model_key').notNull(),
    modelLabel: text('model_label').notNull(),
    bucketName: text('bucket_name').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeInBytes: integer('size_in_bytes').notNull(),
    pageCount: integer('page_count').notNull(),
    dataSnapshot: jsonb('data_snapshot').$type<Record<string, unknown>>(),
    generatedByUserId: text('generated_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('process_generated_document_storage_object_idx').on(
      table.bucketName,
      table.objectKey,
    ),
    index('process_generated_document_process_id_idx').on(table.processId),
    index('process_generated_document_model_key_idx').on(table.modelKey),
    index('process_generated_document_generated_by_user_id_idx').on(
      table.generatedByUserId,
    ),
    index('process_generated_document_generated_at_idx').on(table.generatedAt),
  ],
)

export const processRelations = relations(process, ({ one, many }) => ({
  createdByUser: one(user, {
    fields: [process.createdByUserId],
    references: [user.id],
    relationName: 'process_created_by_user',
  }),
  assignedAttorney: one(user, {
    fields: [process.assignedAttorneyId],
    references: [user.id],
    relationName: 'process_assigned_attorney',
  }),
  witness1: one(user, {
    fields: [process.witness1Id],
    references: [user.id],
    relationName: 'process_witness_1',
  }),
  witness2: one(user, {
    fields: [process.witness2Id],
    references: [user.id],
    relationName: 'process_witness_2',
  }),
  documents: many(processDocument),
  batchFiles: many(processBatchFile),
  generatedDocuments: many(processGeneratedDocument),
  historyEntries: many(processHistory),
}))

export const processHistoryRelations = relations(processHistory, ({ one }) => ({
  process: one(process, {
    fields: [processHistory.processId],
    references: [process.id],
  }),
  actorUser: one(user, {
    fields: [processHistory.actorUserId],
    references: [user.id],
    relationName: 'process_history_actor_user',
  }),
}))

export const processDocumentTypeRelations = relations(
  processDocumentType,
  ({ many }) => ({
    processDocuments: many(processDocument),
  }),
)

export const processDocumentRelations = relations(
  processDocument,
  ({ one, many }) => ({
    process: one(process, {
      fields: [processDocument.processId],
      references: [process.id],
    }),
    documentType: one(processDocumentType, {
      fields: [processDocument.documentTypeId],
      references: [processDocumentType.id],
    }),
    files: many(processDocumentFile),
  }),
)

export const processDocumentFileRelations = relations(
  processDocumentFile,
  ({ one }) => ({
    processDocument: one(processDocument, {
      fields: [processDocumentFile.processDocumentId],
      references: [processDocument.id],
    }),
    uploadedByUser: one(user, {
      fields: [processDocumentFile.uploadedByUserId],
      references: [user.id],
      relationName: 'process_document_file_uploaded_by_user',
    }),
  }),
)

export const processBatchFile = pgTable(
  'process_batch_file',
  {
    id: text('id').primaryKey(),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'cascade' }),
    bucketName: text('bucket_name').notNull(),
    objectKey: text('object_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeInBytes: integer('size_in_bytes').notNull(),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    // Estado do desmembramento/ingestao assincrona (fila duravel):
    // 'idle' | 'queued' | 'processing' | 'done' | 'error'. 'queued' = na fila,
    // esperando o worker reivindicar (api/src/worker.ts). Recuperacao de orfao e do
    // proprio worker: o claim re-reivindica 'processing' com lease expirado (campos
    // abaixo). O fluxo legado de batch-split (claimSplitProcessing) usa 'processing'
    // SEM lease e tem stale-reclaim proprio.
    splitStatus: text('split_status').notNull().default('idle'),
    splitMessage: text('split_message'),
    splitUpdatedAt: timestamp('split_updated_at'),
    // Tentativas ja consumidas (incrementadas no claim). Ao atingir o maximo, o
    // job vira dead-letter ('error' terminal) em vez de re-tentar para sempre.
    splitAttempts: integer('split_attempts').notNull().default(0),
    // Lease: ate quando o worker que reivindicou "segura" o job. Renovado por
    // heartbeat durante o processamento. Em 'processing': expirou < now() => orfao,
    // reivindicavel. Em 'queued': funciona como "elegivel a partir de" (backoff de
    // retry); null = elegivel ja.
    splitLeaseExpiresAt: timestamp('split_lease_expires_at'),
    // Fencing token do claim (uuid): renovacao/conclusao so valem para o dono atual
    // do lease — impede um worker lento/revivido sobrescrever o job ja reivindicado
    // por outro apos a expiracao do lease.
    splitLeaseToken: text('split_lease_token'),
    // Marca quando o job foi para dead-letter (tentativas esgotadas). Observabilidade.
    splitDeadLetterAt: timestamp('split_dead_letter_at'),
  },
  (table) => [
    uniqueIndex('process_batch_file_storage_object_idx').on(
      table.bucketName,
      table.objectKey,
    ),
    index('process_batch_file_process_id_idx').on(table.processId),
    index('process_batch_file_uploaded_by_user_id_idx').on(
      table.uploadedByUserId,
    ),
    // Suporta o claim da fila: filtra por status e ordena por elegibilidade.
    index('process_batch_file_split_claim_idx').on(
      table.splitStatus,
      table.splitLeaseExpiresAt,
    ),
  ],
)

export const processBatchFileRelations = relations(
  processBatchFile,
  ({ one }) => ({
    process: one(process, {
      fields: [processBatchFile.processId],
      references: [process.id],
    }),
    uploadedByUser: one(user, {
      fields: [processBatchFile.uploadedByUserId],
      references: [user.id],
      relationName: 'process_batch_file_uploaded_by_user',
    }),
  }),
)

export const processGeneratedDocumentRelations = relations(
  processGeneratedDocument,
  ({ one }) => ({
    process: one(process, {
      fields: [processGeneratedDocument.processId],
      references: [process.id],
    }),
    generatedByUser: one(user, {
      fields: [processGeneratedDocument.generatedByUserId],
      references: [user.id],
      relationName: 'process_generated_document_generated_by_user',
    }),
  }),
)
