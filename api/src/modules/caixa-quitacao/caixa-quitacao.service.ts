import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { attachSystemChecklistFile } from '../processes/processes.checklist.service'
import { process } from '../processes/processes.schema'

const QUITACAO_DOC_KEY = 'declaracao_quitacao'

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

  await db
    .update(process)
    .set({
      caixaQuitacaoStatus: nextStatus,
      caixaQuitacaoMessage: message.slice(0, 1000),
      caixaQuitacaoCheckedAt: new Date(),
    })
    .where(eq(process.id, input.processId))

  return { status: nextStatus }
}
