import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { logEvent } from '../../shared/observability/log'
import { processBatchFile } from './processes.schema'

// Fila duravel de ingestao (Fase 1). Substitui o modelo fire-and-forget: o job
// vive como linha 'queued' no Postgres e e reivindicado atomicamente por um worker
// (Fase 2) com FOR UPDATE SKIP LOCKED + lease/heartbeat. Sobrevive a reinicio:
// orfaos (lease expirado) sao re-reivindicados; veneno vira dead-letter.
//
// Estas funcoes sao as PRIMITIVAS — ainda nao ligadas ao produtor/worker (isso e
// Fase 2, atras de flag). O sweeper da Fase 0 segue como rede de seguranca.

// Tempo que um worker "segura" o job apos reivindicar. Deve ser > a duracao tipica
// de um job; o worker renova (heartbeat) a cada LEASE_TTL/3 enquanto processa.
export const INGESTION_LEASE_TTL_MS = 5 * 60 * 1000
// Renovacao recomendada do heartbeat (1/3 do TTL da margem a jitter de rede).
export const INGESTION_HEARTBEAT_MS = Math.floor(INGESTION_LEASE_TTL_MS / 3)
// Tentativas antes do dead-letter terminal. Evita re-tentar um PDF-veneno p/ sempre.
export const INGESTION_MAX_ATTEMPTS = 5

// Backoff entre tentativas do MESMO job: base * factor^(attempts-1), com teto.
const BACKOFF_BASE_MS = 30 * 1000
const BACKOFF_FACTOR = 3
const BACKOFF_CAP_MS = 10 * 60 * 1000

// Atraso (ms) antes da proxima tentativa, dado o numero de tentativas ja
// consumidas. Funcao pura — testada isoladamente.
export function computeBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * BACKOFF_FACTOR ** exponent)
}

export type IngestionJob = {
  batchFileId: string
  processId: string
  attempts: number
  leaseToken: string
}

// Executor: o db global ou uma transacao Drizzle (para enfileirar na MESMA tx do
// insert do arquivo — sem janela de inconsistencia entre job e dominio).
type DbExecutor = Pick<typeof db, 'update'>

function leaseIntervalSql(ms: number) {
  const seconds = Math.max(1, Math.floor(ms / 1000))
  return sql`now() + ${sql.raw(String(seconds))} * interval '1 second'`
}

// Enfileira (duravel): marca o arquivo como 'queued', zerando o estado de fila.
// Chamar na mesma tx que insere o processBatchFile (Fase 2).
export async function enqueueIngestion(
  batchFileId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(processBatchFile)
    .set({
      splitStatus: 'queued',
      splitMessage: null,
      splitAttempts: 0,
      splitLeaseExpiresAt: null,
      splitLeaseToken: null,
      splitDeadLetterAt: null,
      splitUpdatedAt: new Date(),
    })
    .where(eq(processBatchFile.id, batchFileId))
}

// Reivindica atomicamente o proximo job: 'queued' elegivel (sem backoff pendente)
// OU 'processing' orfao (lease expirado). Incrementa tentativas, grava lease +
// fencing token novo. FOR UPDATE SKIP LOCKED torna seguro com multiplos workers.
export async function claimNextIngestionJob(): Promise<IngestionJob | null> {
  const leaseToken = crypto.randomUUID()

  const claimed = await db
    .update(processBatchFile)
    .set({
      splitStatus: 'processing',
      splitAttempts: sql`${processBatchFile.splitAttempts} + 1`,
      splitLeaseExpiresAt: leaseIntervalSql(INGESTION_LEASE_TTL_MS),
      splitLeaseToken: leaseToken,
      splitUpdatedAt: sql`now()`,
    })
    .where(
      sql`${processBatchFile.id} = (
        SELECT id FROM ${processBatchFile}
        WHERE (
          split_status = 'queued'
          AND (split_lease_expires_at IS NULL OR split_lease_expires_at < now())
        )
        OR (split_status = 'processing' AND split_lease_expires_at < now())
        -- FIFO por elegibilidade. NAO ordenar por split_attempts: o backoff
        -- (split_lease_expires_at) ja espaca os retries; priorizar quem tem menos
        -- tentativas penaliza duas vezes quem falhou por algo transitorio e, sob
        -- carga continua de jobs novos, poderia starve um job re-tentado.
        ORDER BY split_updated_at ASC NULLS FIRST
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning({
      id: processBatchFile.id,
      processId: processBatchFile.processId,
      attempts: processBatchFile.splitAttempts,
    })

  const row = claimed[0]
  if (!row) {
    return null
  }

  logEvent('ingestion.job.claimed', {
    batchFileId: row.id,
    attempts: row.attempts,
  })
  return {
    batchFileId: row.id,
    processId: row.processId,
    attempts: row.attempts,
    leaseToken,
  }
}

// Renova o lease (heartbeat). So vale para o dono atual (fencing token) e enquanto
// 'processing'. Retorna true se renovou — false significa que perdeu o job (lease
// expirou e foi reivindicado por outro): o chamador deve abortar.
export async function renewIngestionLease(
  batchFileId: string,
  leaseToken: string,
): Promise<boolean> {
  const renewed = await db
    .update(processBatchFile)
    .set({ splitLeaseExpiresAt: leaseIntervalSql(INGESTION_LEASE_TTL_MS) })
    .where(
      and(
        eq(processBatchFile.id, batchFileId),
        eq(processBatchFile.splitStatus, 'processing'),
        eq(processBatchFile.splitLeaseToken, leaseToken),
      ),
    )
    .returning({ id: processBatchFile.id })

  return renewed.length > 0
}

// Conclui com sucesso. Cercado pelo fencing token: um worker que perdeu o lease nao
// sobrescreve o desfecho de outro. Retorna se REALMENTE aplicou (a linha cercada
// casou): com multiplas replicas a re-reivindicacao de orfao e normal, entao um
// worker pode chegar aqui ja sem o lease — nesse caso casa 0 linhas e NAO loga
// 'done' (senao a observabilidade contaria o mesmo job duas vezes). Quem chama
// decide o que fazer com o false.
export async function markIngestionDone(
  batchFileId: string,
  leaseToken: string,
  message: string,
): Promise<boolean> {
  const applied = await db
    .update(processBatchFile)
    .set({
      splitStatus: 'done',
      splitMessage: message,
      splitLeaseExpiresAt: null,
      splitLeaseToken: null,
      splitUpdatedAt: new Date(),
    })
    .where(
      and(
        eq(processBatchFile.id, batchFileId),
        eq(processBatchFile.splitStatus, 'processing'),
        eq(processBatchFile.splitLeaseToken, leaseToken),
      ),
    )
    .returning({ id: processBatchFile.id })

  if (applied.length === 0) {
    return false
  }

  logEvent('ingestion.job.done', { batchFileId })
  return true
}

// Registra falha. Transitoria + tentativas restantes -> volta para 'queued' com
// backoff. Tentativas esgotadas -> dead-letter ('error' terminal). Cercado pelo
// fencing token. `attempts` = numero de tentativas ja consumidas (vindo do claim).
// Retorna se REALMENTE aplicou (a linha cercada casou). Igual ao markIngestionDone:
// um worker que perdeu o lease casa 0 linhas e NAO loga retry/dead-letter falso.
export async function failIngestion(
  batchFileId: string,
  leaseToken: string,
  attempts: number,
  message: string,
): Promise<boolean> {
  const fence = and(
    eq(processBatchFile.id, batchFileId),
    eq(processBatchFile.splitStatus, 'processing'),
    eq(processBatchFile.splitLeaseToken, leaseToken),
  )

  if (attempts >= INGESTION_MAX_ATTEMPTS) {
    const applied = await db
      .update(processBatchFile)
      .set({
        splitStatus: 'error',
        splitMessage: message,
        splitDeadLetterAt: new Date(),
        splitLeaseExpiresAt: null,
        splitLeaseToken: null,
        splitUpdatedAt: new Date(),
      })
      .where(fence)
      .returning({ id: processBatchFile.id })

    if (applied.length === 0) {
      return false
    }

    logEvent('ingestion.job.dead_letter', { batchFileId, attempts })
    return true
  }

  const backoffMs = computeBackoffMs(attempts)
  const applied = await db
    .update(processBatchFile)
    .set({
      splitStatus: 'queued',
      splitMessage: message,
      splitLeaseExpiresAt: leaseIntervalSql(backoffMs),
      splitLeaseToken: null,
      splitUpdatedAt: new Date(),
    })
    .where(fence)
    .returning({ id: processBatchFile.id })

  if (applied.length === 0) {
    return false
  }

  logEvent('ingestion.job.retry', {
    batchFileId,
    attempts,
    backoffMs,
  })
  return true
}
