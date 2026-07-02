import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// Fila DEDICADA e generica da consulta RPA de quitacao Caixa (por CPF). Separa a
// MECANICA operacional (retry/backoff/lease/dead-letter/observabilidade) do dado
// de negocio (o subject: titular, e futuramente processo). O subject guarda apenas
// uma PROJECAO do status; o ciclo de vida do job vive aqui.
//
// Polimorfica por (subject_type, subject_id): um titular (agora) ou um processo
// (migracao futura) sao "subjects" — a fila nao conhece o dominio, so despacha o
// resultado ao handler registrado do subject_type.

export const quitacaoJobSubjectTypes = ['titular', 'process'] as const
export type QuitacaoJobSubjectType = (typeof quitacaoJobSubjectTypes)[number]

// queued: elegivel para claim | running: reivindicado (lease ativo) | done:
// concluido (result quitado/nao_encontrado) | dead: dead-letter (erro terminal apos
// esgotar as tentativas). Retry transitorio volta para 'queued' com backoff.
export const quitacaoJobStatuses = ['queued', 'running', 'done', 'dead'] as const
export type QuitacaoJobStatus = (typeof quitacaoJobStatuses)[number]

export const quitacaoJobResults = ['quitado', 'nao_encontrado', 'erro'] as const
export type QuitacaoJobResult = (typeof quitacaoJobResults)[number]

export const quitacaoJobSubjectTypeEnum = pgEnum(
  'quitacao_job_subject_type',
  quitacaoJobSubjectTypes,
)
export const quitacaoJobStatusEnum = pgEnum(
  'quitacao_job_status',
  quitacaoJobStatuses,
)
export const quitacaoJobResultEnum = pgEnum(
  'quitacao_job_result',
  quitacaoJobResults,
)

export const quitacaoJob = pgTable(
  'quitacao_job',
  {
    id: text('id').primaryKey(),
    subjectType: quitacaoJobSubjectTypeEnum('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    cpf: text('cpf').notNull(),
    status: quitacaoJobStatusEnum('status').default('queued').notNull(),
    // Prioridade do claim (maior primeiro). Reconsulta manual entra com prioridade
    // acima do lote de import, para o usuario ver o resultado antes da fila drenar.
    priority: integer('priority').default(0).notNull(),
    // Tentativas ja consumidas (incrementadas no claim). Base do backoff e do teto.
    attempts: integer('attempts').default(0).notNull(),
    // Nao elegivel ao claim antes deste instante (backoff entre retries).
    runAfter: timestamp('run_after').defaultNow().notNull(),
    // Heartbeat/expiracao do lease. Orfao ('running' com lease vencido) e re-claimavel.
    lockedAt: timestamp('locked_at'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    // Fencing token: um /result so aplica se casar o token do claim vigente (bloqueia
    // resultado atrasado/replay de sobrescrever um job ja re-reivindicado).
    leaseToken: text('lease_token'),
    result: quitacaoJobResultEnum('result'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Claim: filtra por status/run_after e ordena por prioridade.
    index('quitacao_job_claim_idx').on(
      table.status,
      table.runAfter,
      table.priority,
    ),
    // No maximo 1 job por subject: reconsulta reusa a linha (upsert), nao duplica.
    uniqueIndex('quitacao_job_subject_idx').on(
      table.subjectType,
      table.subjectId,
    ),
    index('quitacao_job_cpf_idx').on(table.cpf),
  ],
)

// Historico POR tentativa — observabilidade do RPA instavel (por que o CPF X
// falhou N vezes). Separado do job para nao inflar a linha viva.
export const quitacaoJobAttempt = pgTable(
  'quitacao_job_attempt',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => quitacaoJob.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    result: quitacaoJobResultEnum('result'),
    error: text('error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('quitacao_job_attempt_job_idx').on(table.jobId)],
)

export type QuitacaoJobRow = typeof quitacaoJob.$inferSelect
