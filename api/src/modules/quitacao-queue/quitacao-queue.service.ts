import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { logErrorEvent, logEvent } from '../../shared/observability/log'
import { nextConsultaStatus } from './quitacao-queue.state'
import {
  type QuitacaoJobResult,
  type QuitacaoJobSubjectType,
  quitacaoJob,
  quitacaoJobAttempt,
} from './quitacao-queue.schema'
import { getQuitacaoSubject } from './quitacao-queue.subjects'

// Apos esgotar as tentativas, um 'erro' transitorio vira terminal ('dead'). Com o
// backoff abaixo, 6 tentativas se espalham por ~43min antes do dead-letter.
const MAX_ATTEMPTS = 6
// Lease: tempo que o worker "segura" o job. Orfao (running com lease vencido) e
// re-reivindicavel — cobre crash do worker no meio da consulta.
const LEASE_TTL_SECONDS = 10 * 60

// Backoff exponencial entre retries do MESMO job: 60s * 3^(attempts-1), teto 900s
// => 1min, 3min, 9min, 15min(teto)... da tempo do transitorio (portal sobrecarregado)
// passar sem queimar as tentativas em segundos.
const BACKOFF_BASE_SECONDS = 60
const BACKOFF_FACTOR = 3
const BACKOFF_CAP_SECONDS = 900

function computeBackoffSeconds(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(
    BACKOFF_CAP_SECONDS,
    BACKOFF_BASE_SECONDS * BACKOFF_FACTOR ** exponent,
  )
}

type DbExecutor = Pick<typeof db, 'insert'>

export type EnqueueQuitacaoInput = {
  subjectType: QuitacaoJobSubjectType
  subjectId: string
  cpf: string
  priority?: number
}

// Enfileira (ou re-enfileira) a consulta de UM subject. Upsert por (subject_type,
// subject_id): reconsulta reusa a linha, zera tentativas e volta para 'queued'
// (elegivel imediatamente). Idempotente. Aceita um executor para enfileirar na
// MESMA tx do insert do dominio (sem janela de inconsistencia).
export async function enqueueQuitacao(
  input: EnqueueQuitacaoInput,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .insert(quitacaoJob)
    .values({
      id: crypto.randomUUID(),
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      cpf: input.cpf,
      status: 'queued',
      priority: input.priority ?? 0,
      attempts: 0,
      runAfter: new Date(),
      lockedAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      result: null,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [quitacaoJob.subjectType, quitacaoJob.subjectId],
      set: {
        cpf: sql`excluded.cpf`,
        status: 'queued',
        priority: sql`excluded.priority`,
        attempts: 0,
        runAfter: sql`now()`,
        lockedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        result: null,
        lastError: null,
        updatedAt: sql`now()`,
      },
    })
}

// Enfileira em lote (import de ~13k). Upsert por subject; chunks para nao estourar
// o limite de parametros do driver.
export async function enqueueManyQuitacao(
  rows: EnqueueQuitacaoInput[],
  executor: DbExecutor = db,
): Promise<void> {
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    await executor
      .insert(quitacaoJob)
      .values(
        slice.map((r) => ({
          id: crypto.randomUUID(),
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          cpf: r.cpf,
          status: 'queued' as const,
          priority: r.priority ?? 0,
          attempts: 0,
          runAfter: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [quitacaoJob.subjectType, quitacaoJob.subjectId],
        set: {
          cpf: sql`excluded.cpf`,
          status: 'queued',
          priority: sql`excluded.priority`,
          attempts: 0,
          runAfter: sql`now()`,
          lockedAt: null,
          leaseExpiresAt: null,
          leaseToken: null,
          result: null,
          lastError: null,
          updatedAt: sql`now()`,
        },
      })
  }
}

export type QuitacaoClaim = {
  jobId: string
  leaseToken: string
  subjectType: QuitacaoJobSubjectType
  subjectId: string
  cpf: string
} | null

// Reivindica atomicamente o proximo job: 'queued' elegivel (run_after <= now) OU
// 'running' orfao (lease vencido). Marca 'running', grava lease + fencing token novo,
// incrementa tentativas. FOR UPDATE SKIP LOCKED torna seguro com multiplos workers.
export async function claimNextQuitacaoJob(): Promise<QuitacaoClaim> {
  const leaseToken = crypto.randomUUID()

  const claimed = await db
    .update(quitacaoJob)
    .set({
      status: 'running',
      lockedAt: sql`now()`,
      leaseExpiresAt: sql`now() + ${sql.raw(String(LEASE_TTL_SECONDS))} * interval '1 second'`,
      leaseToken,
      attempts: sql`${quitacaoJob.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      sql`${quitacaoJob.id} = (
        SELECT id FROM ${quitacaoJob}
        WHERE (status = 'queued' AND run_after <= now())
          OR (status = 'running' AND lease_expires_at < now())
        ORDER BY priority DESC, run_after ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning({
      id: quitacaoJob.id,
      subjectType: quitacaoJob.subjectType,
      subjectId: quitacaoJob.subjectId,
      cpf: quitacaoJob.cpf,
      attempts: quitacaoJob.attempts,
    })

  const row = claimed[0]
  if (!row) return null

  logEvent('quitacao_queue.claimed', {
    jobId: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    attempts: row.attempts,
  })

  return {
    jobId: row.id,
    leaseToken,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    cpf: row.cpf,
  }
}

export type RecordQuitacaoResultInput = {
  jobId: string
  leaseToken: string
  result: QuitacaoJobResult
  message?: string | null
  pdfBase64?: string | null
  pdfFilename?: string | null
}

// Registra o desfecho do job. Guardado por (status='running' + lease_token): um
// /result atrasado/replay nao sobrescreve um job ja re-reivindicado.
//
// 'quitado' + PDF: anexa o termo via handler do subject. Se o anexo falhar, o job
// NAO conclui — volta para 'queued' (retry, a consulta e idempotente) ate esgotar
// as tentativas. Assim uma quitacao ja confirmada nao se perde por falha de storage.
export async function recordQuitacaoJobResult(
  input: RecordQuitacaoResultInput,
): Promise<{ status: string }> {
  const [job] = await db
    .select({
      id: quitacaoJob.id,
      subjectType: quitacaoJob.subjectType,
      subjectId: quitacaoJob.subjectId,
      status: quitacaoJob.status,
      attempts: quitacaoJob.attempts,
      leaseToken: quitacaoJob.leaseToken,
    })
    .from(quitacaoJob)
    .where(eq(quitacaoJob.id, input.jobId))
    .limit(1)

  if (!job) {
    throw new ServiceError(404, 'Job de quitacao nao encontrado.')
  }
  // Correlaciona o resultado com o claim vigente (fencing).
  if (job.status !== 'running' || job.leaseToken !== input.leaseToken) {
    logEvent('quitacao_queue.result_rejected', {
      jobId: job.id,
      status: job.status,
      reason: 'stale_or_not_running',
    })
    throw new ServiceError(
      409,
      'Nenhuma consulta em andamento para este job (lease invalido).',
    )
  }

  const handler = getQuitacaoSubject(job.subjectType)
  const exhausted = job.attempts >= MAX_ATTEMPTS

  // Quitado + PDF: anexa o termo ao subject ANTES de finalizar o job.
  let attachFailed = false
  let attachError = ''
  if (input.result === 'quitado' && input.pdfBase64) {
    try {
      const bytes = Buffer.from(input.pdfBase64, 'base64')
      await handler.attachDocument(job.subjectId, {
        bytes,
        filename: input.pdfFilename ?? 'Declaracao de Quitacao.pdf',
        contentType: 'application/pdf',
      })
    } catch (error) {
      attachError = error instanceof Error ? error.message : String(error)
      logErrorEvent('quitacao_queue.attach_failed', {
        jobId: job.id,
        error: attachError,
      })
      attachFailed = true
    }
  }

  // Reusa a maquina de estados pura da quitacao: mapeia (result + attachFailed +
  // exhausted) para o proximo estado da consulta.
  const consultaState = nextConsultaStatus(input.result, {
    attachFailed,
    exhausted,
  })
  const nowIso = new Date()

  // consultaState 'pending' => retry (job volta para 'queued' com backoff).
  // 'quitado'/'nao_encontrado' => job 'done'. 'erro' => dead-letter.
  const isRetry = consultaState === 'pending'
  const isDead = consultaState === 'erro'

  const message =
    input.result === 'quitado' && attachFailed
      ? `Quitado, mas falhou ao anexar a declaracao: ${attachError}`.slice(0, 500)
      : (input.message ?? '').slice(0, 500)

  const fence = and(
    eq(quitacaoJob.id, input.jobId),
    eq(quitacaoJob.status, 'running'),
    eq(quitacaoJob.leaseToken, input.leaseToken),
  )

  let nextJobStatus: 'queued' | 'done' | 'dead'
  if (isRetry) {
    nextJobStatus = 'queued'
    const backoff = computeBackoffSeconds(job.attempts)
    await db
      .update(quitacaoJob)
      .set({
        status: 'queued',
        result: null,
        lastError: message || null,
        runAfter: sql`now() + ${sql.raw(String(backoff))} * interval '1 second'`,
        lockedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        updatedAt: sql`now()`,
      })
      .where(fence)
  } else {
    nextJobStatus = isDead ? 'dead' : 'done'
    await db
      .update(quitacaoJob)
      .set({
        status: nextJobStatus,
        result: input.result,
        lastError: isDead ? message || null : null,
        lockedAt: null,
        leaseExpiresAt: null,
        leaseToken: null,
        updatedAt: sql`now()`,
      })
      .where(fence)
  }

  // Historico da tentativa (observabilidade).
  await db.insert(quitacaoJobAttempt).values({
    id: crypto.randomUUID(),
    jobId: job.id,
    attemptNo: job.attempts,
    result: input.result,
    error: message || null,
  })

  // Projeta o desfecho TERMINAL na linha de negocio. Em retry, mantem 'pending'
  // (projection.status = null nao mexe na linha).
  const projectionStatus =
    consultaState === 'pending'
      ? null
      : consultaState === 'quitado'
        ? 'quitado'
        : consultaState === 'nao_encontrado'
          ? 'nao_encontrado'
          : 'erro'
  try {
    await handler.projectResult(job.subjectId, {
      status: projectionStatus,
      message: message || undefined,
      checkedAt: nowIso,
    })
  } catch (error) {
    // Projecao e best-effort: nao reverte o job (o resultado ja e duravel na fila).
    logErrorEvent('quitacao_queue.project_failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logEvent('quitacao_queue.recorded', {
    jobId: job.id,
    result: input.result,
    jobStatus: nextJobStatus,
  })

  return { status: nextJobStatus }
}
