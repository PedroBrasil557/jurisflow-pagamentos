import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/auth.schema'

export const housingComplex = pgTable(
  'housing_complex',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    zipcode: text('zipcode'),
    // Dados usados na geracao da peticao inicial dos processos do conjunto.
    vara: text('vara'),
    causeValue: text('cause_value'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex('housing_complex_name_idx').on(table.name)],
)

// Documentos anexados no nivel do CONJUNTO (ex.: solicitacao Caixa, requerimento
// administrativo, matricula). Um arquivo corrente por (conjunto, tipo); espelhado
// somente leitura no checklist de todos os processos do conjunto.
export const housingComplexFile = pgTable(
  'housing_complex_file',
  {
    id: text('id').primaryKey(),
    housingComplexId: text('housing_complex_id')
      .notNull()
      .references(() => housingComplex.id, { onDelete: 'cascade' }),
    documentTypeKey: text('document_type_key').notNull(),
    bucketName: text('bucket_name').notNull(),
    objectKey: text('object_key').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeInBytes: integer('size_in_bytes').notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    replacedAt: timestamp('replaced_at'),
  },
  (table) => [
    uniqueIndex('housing_complex_file_storage_object_idx').on(
      table.bucketName,
      table.objectKey,
    ),
    index('housing_complex_file_complex_id_idx').on(table.housingComplexId),
    index('housing_complex_file_complex_key_current_idx').on(
      table.housingComplexId,
      table.documentTypeKey,
      table.isCurrent,
    ),
    // Garante no maximo 1 arquivo corrente por (conjunto, tipo).
    uniqueIndex('housing_complex_file_current_unique_idx')
      .on(table.housingComplexId, table.documentTypeKey)
      .where(sql`${table.isCurrent}`),
  ],
)
