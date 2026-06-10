import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
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

// Apos esgotar as tentativas, um 'erro' transitorio vira terminal.
const MAX_ATTEMPTS = 3
const STALE_MINUTES = 10

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
        WHERE caixa_quitacao_status = 'pending'
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
    throw new ServiceError(404, 'Processo nao encontrado.')
  }

  // Correlaciona o resultado com o claim: so aceita /result para um processo que
  // esta REALMENTE sendo consultado ('processing' — estado em que so o claim do
  // worker poe o processo). Bloqueia /result forjado/replay para um processId
  // arbitrario (que injetaria uma declaracao falsa via attachSystemChecklistFile).
  if (proc.status !== 'processing') {
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
      await attachSystemChecklistFile({
        processId: input.processId,
        documentTypeKey: QUITACAO_DOC_KEY,
        file,
      })
    } catch (error) {
      result = 'erro'
      message = `Quitado, mas falhou ao anexar a declaracao: ${
        error instanceof Error ? error.message : 'erro'
      }`
    }
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
    return { status: 'ignored' }
  }

  return { status: nextStatus }
}
