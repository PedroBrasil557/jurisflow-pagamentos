import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { user } from '../auth/auth.schema'
import { process } from '../processes/processes.schema'

// Camada generica de auditoria/evidencia de IA. APPEND-ONLY: uma linha por
// chamada de IA, escrita uma unica vez no fim (sem updatedAt). O estado
// operacional do job (em andamento) NAO vive aqui — fica no consumidor (ex.:
// process.caixaAnalysisStatus). Aqui mora apenas a evidencia imutavel do que a
// IA retornou + a decisao derivada. processId e sempre obrigatorio: toda rotina
// de IA e vinculada a um processo.

// Tipo da rotina que gerou a analise. Mantido como `text` (extensivel sem
// migracao), mas tipado no codigo. Novos consumidores acrescentam aqui.
export type AiAnalysisKind =
  | 'caixa_owner'
  | 'document_extraction'
  | 'procuracao_conjunto'

// Referencia (nao os bytes) do artefato analisado — permite provar qual versao
// do arquivo gerou a decisao mesmo se o objeto for movido/substituido.
export type AiAnalysisContext = {
  documentKey?: string
  fileId?: string
  revision?: number
  contentSha256?: string
}

export const aiAnalysisStatusEnum = pgEnum('ai_analysis_status', [
  'ok',
  'error',
])
export const aiAnalysisTriggerSourceEnum = pgEnum(
  'ai_analysis_trigger_source',
  ['system', 'user'],
)

export const aiAnalysis = pgTable(
  'ai_analysis',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<AiAnalysisKind>().notNull(),
    processId: text('process_id')
      .notNull()
      .references(() => process.id, { onDelete: 'restrict' }),
    context: jsonb('context').$type<AiAnalysisContext | null>(),
    // Modelo RESOLVIDO (message.model), nao o alias do request.
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    // Resumo/referencia minimizado da entrada (snapshot do titular, refs) —
    // nunca os bytes do documento.
    input: jsonb('input').$type<Record<string, unknown> | null>(),
    // Saida estruturada (validada) do modelo: "o que a IA retornou".
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    // Decisao deterministica derivada pelo consumidor (ex.: titular/review).
    decision: jsonb('decision').$type<Record<string, unknown> | null>(),
    // Apenas evidencia — NUNCA usado para decidir auto-aplicacao.
    confidence: smallint('confidence'),
    status: aiAnalysisStatusEnum('status').notNull(),
    errorMessage: text('error_message'),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    durationMs: integer('duration_ms'),
    triggerSource: aiAnalysisTriggerSourceEnum('trigger_source').notNull(),
    // Humano que originou o gatilho (ex.: quem anexou o doc). Null = sistema.
    triggeredByUserId: text('triggered_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('ai_analysis_process_id_created_at_idx').on(
      table.processId,
      table.createdAt,
    ),
    index('ai_analysis_kind_created_at_idx').on(table.kind, table.createdAt),
  ],
)

export type AiAnalysisInsert = typeof aiAnalysis.$inferInsert
export type AiAnalysisRow = typeof aiAnalysis.$inferSelect
