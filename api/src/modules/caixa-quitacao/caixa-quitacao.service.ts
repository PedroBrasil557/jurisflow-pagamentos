import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { process } from '../processes/processes.schema'

export type QuitacaoJob = { processId: string; cpf: string } | null

// Apos esgotar as tentativas, um 'erro' transitorio vira terminal.
const MAX_ATTEMPTS = 3
const STALE_MINUTES = 10

// Reivindica atomicamente o proximo processo a consultar: 'pending', ou
// 'processing' travado (orfao > STALE_MINUTES). Marca 'processing' e incrementa
// as tentativas. (Single worker no dev; para multi-worker, adicionar
// FOR UPDATE SKIP LOCKED no subselect.)
export async function claimNextQuitacaoJob(): Promise<QuitacaoJob> {
  const claimed = await db
    .update(process)
    .set({
      caixaQuitacaoStatus: 'processing',
      caixaQuitacaoAttempts: sql`${process.caixaQuitacaoAttempts} + 1`,
    })
    .where(
      sql`${process.id} = (
        SELECT id FROM ${process}
        WHERE caixa_quitacao_status = 'pending'
           OR (caixa_quitacao_status = 'processing'
               AND updated_at < now() - interval '${sql.raw(String(STALE_MINUTES))} minutes')
        ORDER BY caixa_quitacao_attempts ASC, updated_at ASC
        LIMIT 1
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
    .select({ attempts: process.caixaQuitacaoAttempts })
    .from(process)
    .where(eq(process.id, input.processId))
    .limit(1)

  if (!proc) {
    throw new ServiceError(404, 'Processo nao encontrado.')
  }

  let nextStatus: string = input.result
  if (input.result === 'erro' && proc.attempts < MAX_ATTEMPTS) {
    nextStatus = 'pending'
  }

  await db
    .update(process)
    .set({
      caixaQuitacaoStatus: nextStatus,
      caixaQuitacaoMessage: input.message.slice(0, 1000),
      caixaQuitacaoCheckedAt: new Date(),
    })
    .where(eq(process.id, input.processId))

  return { status: nextStatus }
}
