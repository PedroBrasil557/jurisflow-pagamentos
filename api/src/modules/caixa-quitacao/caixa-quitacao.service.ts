import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { logErrorEvent, logEvent } from '../../shared/observability/log'
import { attachSystemChecklistFile } from '../processes/processes.checklist.service'
import { process } from '../processes/processes.schema'
import {
  aggregateQuitacaoStatus,
  nextConsultaStatus,
  type QuitacaoConsulta,
} from './quitacao-consulta'

const QUITACAO_DOC_KEY = 'declaracao_quitacao'

// Reconsulta sob demanda (usuario): volta TODAS as entradas de consulta para
// 'pending' (re-consulta cada CPF do titular do contrato Caixa). Usa os CPFs ja
// derivados (em quitacao_consultas) — NUNCA o process.cpf. Se nao ha titular
// derivado, recusa (em vez de consultar um CPF possivelmente errado).
export async function requestQuitacaoRecheck(
  processId: string,
): Promise<{ status: 'pending' }> {
  const [proc] = await db
    .select({ consultas: process.quitacaoConsultas })
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)

  if (!proc) {
    throw new ServiceError(404, 'Processo nao encontrado.')
  }
  const consultas = proc.consultas ?? []
  if (consultas.length === 0) {
    throw new ServiceError(
      400,
      'Sem titular do contrato Caixa derivado para consultar a quitacao.',
    )
  }

  const reset: QuitacaoConsulta[] = consultas.map((c) => ({
    cpf: c.cpf,
    status: 'pending',
  }))
  await db
    .update(process)
    .set({
      quitacaoConsultas: reset,
      caixaQuitacaoStatus: 'pending',
      caixaQuitacaoAttempts: 0,
    })
    .where(eq(process.id, processId))

  return { status: 'pending' }
}

export type QuitacaoJob = {
  processId: string
  cpfs: string[]
  claimToken: string
} | null

// Apos esgotar as tentativas, um 'erro' transitorio vira terminal. Com o backoff
// abaixo, 6 tentativas se espalham por ~43min antes do terminal (-> recheck
// manual). (Nota: 'process' aqui e a TABELA Drizzle, nao o global do Node.)
const MAX_ATTEMPTS = 6
const STALE_MINUTES = 10

// Backoff exponencial entre retries do MESMO processo: 60s * 3^(attempts-1),
// com teto de 900s => 1min, 3min, 9min, 15min(teto), 15min... Da tempo do
// transitorio (site sobrecarregado) passar sem queimar as tentativas em segundos.
// O processo continua 'pending' (duravel) — so fica INELEGIVEL ate o backoff
// passar, e reentra sozinho no proximo claim.
const BACKOFF_BASE_SECONDS = 60
const BACKOFF_FACTOR = 3
const BACKOFF_CAP_SECONDS = 900

// Reivindica atomicamente o proximo processo a consultar: 'pending', ou
// 'processing' travado (orfao > STALE_MINUTES). Marca 'processing' e incrementa
// as tentativas. FOR UPDATE SKIP LOCKED no subselect torna o claim seguro com
// multiplos workers (ex.: overlap de rolling deploy) — sem dupla reivindicacao.
export async function claimNextQuitacaoJob(): Promise<QuitacaoJob> {
  // Token novo por claim (fencing): correlaciona o /result com ESTE claim. Um
  // /result de um claim re-reivindicado por staleness casa 0 linhas (token
  // diferente) e vira no-op, em vez de sobrescrever o estado vivo.
  const claimToken = crypto.randomUUID()

  const claimed = await db
    .update(process)
    .set({
      caixaQuitacaoStatus: 'processing',
      caixaQuitacaoStartedAt: sql`now()`,
      caixaQuitacaoClaimToken: claimToken,
      caixaQuitacaoAttempts: sql`${process.caixaQuitacaoAttempts} + 1`,
    })
    .where(
      // Staleness por caixa_quitacao_started_at (heartbeat do claim), NAO por
      // updated_at — que e tocado por qualquer edicao do processo e mascararia
      // um job orfao (job vivo nunca expira / orfao nunca expira).
      sql`${process.id} = (
        SELECT id FROM ${process}
        WHERE (
          caixa_quitacao_status = 'pending'
          AND (
            caixa_quitacao_attempts = 0
            OR caixa_quitacao_started_at IS NULL
            OR caixa_quitacao_started_at < now() - (
              LEAST(
                ${sql.raw(String(BACKOFF_CAP_SECONDS))},
                ${sql.raw(String(BACKOFF_BASE_SECONDS))} * power(${sql.raw(String(BACKOFF_FACTOR))}, caixa_quitacao_attempts - 1)
              )::int * interval '1 second'
            )
          )
        )
        OR (caixa_quitacao_status = 'processing'
            AND caixa_quitacao_started_at < now() - interval '${sql.raw(String(STALE_MINUTES))} minutes')
        ORDER BY caixa_quitacao_attempts ASC, caixa_quitacao_started_at ASC NULLS FIRST
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning({
      id: process.id,
      consultas: process.quitacaoConsultas,
    })

  const row = claimed[0]
  if (!row) return null
  // CPFs ainda PENDENTES (titulares do contrato Caixa). O worker consulta cada um
  // ate o primeiro emitir o termo. Os terminais (quitado/nao_encontrado/erro) NAO
  // sao re-consultados. NAO ha fallback para process.cpf.
  const cpfs = (row.consultas ?? [])
    .filter((c) => c.status === 'pending')
    .map((c) => c.cpf)
  if (cpfs.length === 0) {
    // Invariante quebrada (pending sem CPF pendente): volta para idle para nao
    // re-reivindicar em loop; o reconcile re-enfileira se derivar.
    await db
      .update(process)
      .set({ caixaQuitacaoStatus: 'idle' })
      .where(eq(process.id, row.id))
    return null
  }
  return { processId: row.id, cpfs, claimToken }
}

export type QuitacaoResultInput = {
  processId: string
  // Token do claim vigente (fencing): correlaciona o resultado com ESTE claim.
  // OPCIONAL por compatibilidade de rolling deploy: um worker antigo (sem o
  // patch) posta /result sem token — nesse caso cai no gate por status apenas
  // (comportamento legado, seguro pois o worker antigo e single-flight). O worker
  // novo SEMPRE envia, entao o fence fica ativo sob concorrencia.
  claimToken?: string
  // Resultado POR CPF que o worker tentou (na ordem; para no primeiro quitado).
  consultas: Array<{
    cpf: string
    result: 'quitado' | 'nao_encontrado' | 'erro'
    message?: string
  }>
  pdfBase64?: string | null
  pdfFilename?: string | null
}

// Registra o desfecho POR CPF. Atualiza cada entrada em quitacao_consultas (preserva
// as outras), anexa o termo se algum CPF quitou, e recomputa o agregado. 'erro' e
// transitorio: volta o CPF para 'pending' (retry) enquanto houver tentativas; ao
// esgotar, vira terminal 'erro'.
export async function recordQuitacaoResult(
  input: QuitacaoResultInput,
): Promise<{ status: string }> {
  const [proc] = await db
    .select({
      status: process.caixaQuitacaoStatus,
      attempts: process.caixaQuitacaoAttempts,
      consultas: process.quitacaoConsultas,
      claimToken: process.caixaQuitacaoClaimToken,
    })
    .from(process)
    .where(eq(process.id, input.processId))
    .limit(1)

  if (!proc) {
    logEvent('quitacao.result_received', {
      processId: input.processId,
      procStatus: 'not_found',
    })
    throw new ServiceError(404, 'Processo nao encontrado.')
  }

  const quitouCpf = input.consultas.find((c) => c.result === 'quitado')?.cpf
  logEvent('quitacao.result_received', {
    processId: input.processId,
    consultas: input.consultas.map((c) => ({ cpf: c.cpf, result: c.result })),
    hasPdf: !!input.pdfBase64,
    procStatus: proc.status,
    attempts: proc.attempts,
  })

  // Correlaciona o resultado com o claim: so aceita /result para um processo
  // 'processing' (estado em que so o claim do worker poe o processo) E — quando o
  // worker envia o token — cujo token de claim casa. Bloqueia /result forjado/replay
  // (declaracao falsa) e /result de um claim OBSOLETO (re-reivindicado por staleness
  // enquanto o worker original ainda processava) — que sob concorrencia sobrescreveria
  // o estado vivo ou perderia uma quitacao ja confirmada. Token ausente (worker legado
  // no rolling deploy) cai no gate por status apenas — seguro pois e single-flight.
  const staleToken =
    input.claimToken != null && proc.claimToken !== input.claimToken
  if (proc.status !== 'processing' || staleToken) {
    logEvent('quitacao.result_rejected', {
      processId: input.processId,
      procStatus: proc.status,
      reason:
        proc.status !== 'processing' ? 'not_processing' : 'stale_claim_token',
    })
    throw new ServiceError(
      409,
      'Nenhuma consulta de quitacao em andamento para este processo (claim invalido).',
    )
  }

  // Quitado + PDF: anexa a Declaracao de Quitacao (do CPF que emitiu). Se o anexo
  // falhar, esse CPF NAO termina como 'quitado': volta para 'pending' (reprocessa —
  // a consulta e idempotente) ate as tentativas esgotarem. Assim uma quitacao ja
  // confirmada nao e perdida por uma falha transitoria de armazenamento.
  let attachFailed = false
  let attachError = ''
  if (quitouCpf && input.pdfBase64) {
    try {
      const bytes = Buffer.from(input.pdfBase64, 'base64')
      const file = new File(
        [bytes],
        input.pdfFilename ?? 'Declaracao de Quitacao.pdf',
        { type: 'application/pdf' },
      )
      const attached = await attachSystemChecklistFile({
        processId: input.processId,
        documentTypeKey: QUITACAO_DOC_KEY,
        file,
      })
      logEvent('quitacao.attach', {
        processId: input.processId,
        cpf: quitouCpf,
        didUploadFile: attached?.didUploadFile ?? null,
        pdfBytes: bytes.length,
      })
    } catch (error) {
      attachError = error instanceof Error ? error.message : String(error)
      logErrorEvent('quitacao.attach_failed', {
        processId: input.processId,
        error: attachError,
      })
      attachFailed = true
    }
  } else if (quitouCpf && !input.pdfBase64) {
    logEvent('quitacao.attach', {
      processId: input.processId,
      cpf: quitouCpf,
      didUploadFile: false,
      reason: 'no_pdf',
    })
  }

  // Aplica o resultado em cada entrada (preserva as demais). 'erro' transitorio ->
  // 'pending' (retry) enquanto attempts < MAX; ao esgotar, terminal 'erro'.
  const exhausted = proc.attempts >= MAX_ATTEMPTS
  const nowIso = new Date().toISOString()
  const byCpf = new Map<string, QuitacaoConsulta>(
    (proc.consultas ?? []).map((c) => [c.cpf, { ...c }]),
  )
  for (const r of input.consultas) {
    const entry = byCpf.get(r.cpf)
    if (!entry) continue
    entry.status = nextConsultaStatus(r.result, { attachFailed, exhausted })
    entry.checkedAt = nowIso
    // Quitou mas falhou ao anexar: preserva o MOTIVO real (sem isso, a mensagem
    // visivel seria a do "quitado" e esconderia a causa da volta para retry/erro).
    entry.message =
      r.result === 'quitado' && attachFailed
        ? `Quitado, mas falhou ao anexar a declaracao: ${attachError}`.slice(
            0,
            500,
          )
        : r.message?.slice(0, 500)
  }
  const nextConsultas = [...byCpf.values()]
  const nextStatus = aggregateQuitacaoStatus(nextConsultas)
  const message =
    input.consultas.find((c) => c.cpf === quitouCpf)?.message ??
    input.consultas[0]?.message ??
    ''

  // Transicao atomica guardada por status='processing' + token do claim vigente:
  // um /result fora de ordem, repetido, ou de um claim obsoleto casa 0 linhas e
  // NAO sobrescreve o estado vivo.
  const updated = await db
    .update(process)
    .set({
      quitacaoConsultas: nextConsultas,
      caixaQuitacaoStatus: nextStatus,
      caixaQuitacaoMessage: message.slice(0, 1000),
      caixaQuitacaoCheckedAt: new Date(),
    })
    .where(
      and(
        eq(process.id, input.processId),
        eq(process.caixaQuitacaoStatus, 'processing'),
        // Fence pelo token so quando o worker o envia (ver nota no gate).
        input.claimToken != null
          ? eq(process.caixaQuitacaoClaimToken, input.claimToken)
          : undefined,
      ),
    )
    .returning({ id: process.id })

  if (updated.length === 0) {
    logEvent('quitacao.recorded', {
      processId: input.processId,
      finalStatus: 'ignored',
      reason: 'status_changed_during_record',
    })
    return { status: 'ignored' }
  }

  logEvent('quitacao.recorded', {
    processId: input.processId,
    finalStatus: nextStatus,
    quitouCpf: quitouCpf ?? null,
  })

  return { status: nextStatus }
}
