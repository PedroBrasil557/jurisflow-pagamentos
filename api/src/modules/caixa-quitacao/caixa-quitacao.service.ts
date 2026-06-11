import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { logErrorEvent, logEvent } from '../../shared/observability/log'
import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'
import { attachSystemChecklistFile } from '../processes/processes.checklist.service'
import { process } from '../processes/processes.schema'

const QUITACAO_DOC_KEY = 'declaracao_quitacao'

// Enfileira a consulta de quitacao SE o CPF for valido e a consulta ainda nao
// foi iniciada (status 'idle'). Idempotente — chamada na criacao do processo e
// apos a extracao do scan preencher o CPF; nao re-enfileira o que ja rodou.
export async function enqueueQuitacaoCheck(
  processId: string,
  cpf: string,
): Promise<void> {
  if (!isValidCpf(normalizeCpf(cpf))) {
    return
  }
  await db
    .update(process)
    .set({ caixaQuitacaoStatus: 'pending', caixaQuitacaoAttempts: 0 })
    .where(
      and(eq(process.id, processId), eq(process.caixaQuitacaoStatus, 'idle')),
    )
}

// Reconsulta sob demanda (usuario): re-enfileira independentemente do status.
export async function requestQuitacaoRecheck(
  processId: string,
): Promise<{ status: 'pending' }> {
  const [proc] = await db
    .select({ cpf: process.cpf })
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)

  if (!proc) {
    throw new ServiceError(404, 'Processo nao encontrado.')
  }
  if (!isValidCpf(normalizeCpf(proc.cpf))) {
    throw new ServiceError(
      400,
      'Processo sem CPF valido para consultar a quitacao.',
    )
  }

  await db
    .update(process)
    .set({ caixaQuitacaoStatus: 'pending', caixaQuitacaoAttempts: 0 })
    .where(eq(process.id, processId))

  return { status: 'pending' }
}

export type QuitacaoJob = { processId: string; cpf: string } | null

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
  const claimed = await db
    .update(process)
    .set({
      caixaQuitacaoStatus: 'processing',
      caixaQuitacaoStartedAt: sql`now()`,
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
    .returning({ id: process.id, cpf: process.cpf })

  const row = claimed[0]
  return row ? { processId: row.id, cpf: row.cpf } : null
}

export type QuitacaoResultInput = {
  processId: string
  result: 'quitado' | 'nao_encontrado' | 'erro'
  message: string
  pdfBase64?: string | null
  pdfFilename?: string | null
}

// Registra o desfecho da consulta. 'erro' transitorio volta para 'pending'
// (retry) enquanto houver tentativas. (Fase 1b: se 'quitado' + pdf, anexar o PDF
// ao slot declaracao_quitacao — que dispara a analise do titular.)
export async function recordQuitacaoResult(
  input: QuitacaoResultInput,
): Promise<{ status: string }> {
  const [proc] = await db
    .select({
      status: process.caixaQuitacaoStatus,
      attempts: process.caixaQuitacaoAttempts,
    })
    .from(process)
    .where(eq(process.id, input.processId))
    .limit(1)

  if (!proc) {
    logEvent('quitacao.result_received', {
      processId: input.processId,
      result: input.result,
      hasPdf: !!input.pdfBase64,
      procStatus: 'not_found',
    })
    throw new ServiceError(404, 'Processo nao encontrado.')
  }

  logEvent('quitacao.result_received', {
    processId: input.processId,
    result: input.result,
    hasPdf: !!input.pdfBase64,
    pdfBytes: input.pdfBase64
      ? Buffer.from(input.pdfBase64, 'base64').length
      : 0,
    procStatus: proc.status,
    attempts: proc.attempts,
  })

  // Correlaciona o resultado com o claim: so aceita /result para um processo que
  // esta REALMENTE sendo consultado ('processing' — estado em que so o claim do
  // worker poe o processo). Bloqueia /result forjado/replay para um processId
  // arbitrario (que injetaria uma declaracao falsa via attachSystemChecklistFile).
  if (proc.status !== 'processing') {
    logEvent('quitacao.result_rejected', {
      processId: input.processId,
      procStatus: proc.status,
      reason: 'not_processing',
    })
    throw new ServiceError(
      409,
      'Nenhuma consulta de quitacao em andamento para este processo.',
    )
  }

  let result: QuitacaoResultInput['result'] = input.result
  let message = input.message

  // Quitado + PDF: anexa a Declaracao de Quitacao no slot declaracao_quitacao
  // (isso dispara a analise do titular do contrato). Se o anexo falhar, trata
  // como erro para reprocessar (a consulta e idempotente).
  if (input.result === 'quitado' && input.pdfBase64) {
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
      // didUploadFile=false => o anexo foi PULADO de PROPOSITO (status do processo
      // nao aceita anexos: EM_PROCESSO/FINALIZADO/CANCELADO - guard A3). NAO vira
      // 'erro' (evita retry infinito), mas o log torna o caso VISIVEL: era o ponto
      // cego onde o sistema marcava quitado sem anexar o termo, silenciosamente.
      logEvent('quitacao.attach', {
        processId: input.processId,
        documentTypeKey: QUITACAO_DOC_KEY,
        didUploadFile: attached?.didUploadFile ?? null,
        pdfBytes: bytes.length,
      })
    } catch (error) {
      logErrorEvent('quitacao.attach_failed', {
        processId: input.processId,
        error: error instanceof Error ? error.message : String(error),
      })
      result = 'erro'
      message = `Quitado, mas falhou ao anexar a declaracao: ${
        error instanceof Error ? error.message : 'erro'
      }`
    }
  } else if (input.result === 'quitado' && !input.pdfBase64) {
    // Quitado SEM PDF: o worker nao mandou a declaracao. Visibilidade do caso.
    logEvent('quitacao.attach', {
      processId: input.processId,
      documentTypeKey: QUITACAO_DOC_KEY,
      didUploadFile: false,
      pdfBytes: 0,
      reason: 'no_pdf',
    })
  }

  let nextStatus: string = result
  if (result === 'erro' && proc.attempts < MAX_ATTEMPTS) {
    nextStatus = 'pending'
  }

  // Transicao atomica guardada por status='processing': um /result fora de ordem
  // ou repetido (apos o processo ja ter saido de 'processing') nao sobrescreve o
  // estado vivo.
  const updated = await db
    .update(process)
    .set({
      caixaQuitacaoStatus: nextStatus,
      caixaQuitacaoMessage: message.slice(0, 1000),
      caixaQuitacaoCheckedAt: new Date(),
    })
    .where(
      and(
        eq(process.id, input.processId),
        eq(process.caixaQuitacaoStatus, 'processing'),
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
    result,
  })

  return { status: nextStatus }
}
