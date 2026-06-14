import { and, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { getStorageObjectBytes } from '../../shared/storage/s3'
import { recordAiAnalysis } from '../ai-analysis/ai-analysis.service'
import { getAnthropicApiKey } from '../settings/settings.service'
import { reconcileOwnerType } from './derive/reconcile'
import { extractCaixaOwner } from './processes.caixa-owner.helper'
import {
  process,
  processDocument,
  processDocumentFile,
  processDocumentType,
} from './processes.schema'

// Documentos-fonte do nome do comprador (ja existem no checklist).
const CAIXA_DOC_KEYS = [
  'termo_entrega_recebimento_imovel',
  'declaracao_quitacao',
] as const

const PROMPT_VERSION = 'caixa_owner@2'
// Apos isso, um 'processing' e considerado orfao (crash/restart) e pode ser
// re-reivindicado — mesmo padrao da consulta de quitacao.
const CAIXA_STALE_MINUTES = 10

export function isCaixaOwnerDocKey(key: string): boolean {
  return (CAIXA_DOC_KEYS as readonly string[]).includes(key)
}

// Reivindica o job atomicamente: so um por vez. Reivindica se NAO esta
// 'processing' OU se o 'processing' esta obsoleto (> CAIXA_STALE_MINUTES) — um
// job orfao (crash/restart) e assim recuperavel sem depender so do boot, e um
// job vivo (updated_at recente) nao e reivindicado em duplicidade.
async function claimCaixaAnalysis(processId: string): Promise<boolean> {
  const claimed = await db
    .update(process)
    .set({
      caixaAnalysisStatus: 'processing',
      caixaAnalysisStartedAt: sql`now()`,
    })
    .where(
      and(
        eq(process.id, processId),
        or(
          ne(process.caixaAnalysisStatus, 'processing'),
          // Staleness pelo heartbeat (setado so aqui), NAO por updated_at — que
          // qualquer edicao do processo tocaria, mascarando um job orfao.
          lt(
            process.caixaAnalysisStartedAt,
            sql`now() - interval '${sql.raw(String(CAIXA_STALE_MINUTES))} minutes'`,
          ),
        ),
      ),
    )
    .returning({ id: process.id })

  return claimed.length > 0
}

// Atualiza o estado operacional. Nunca lanca (o sucesso/falha do job nao pode
// depender disto).
async function setCaixaStatus(
  processId: string,
  status: 'idle' | 'done' | 'review' | 'error',
): Promise<void> {
  try {
    await db
      .update(process)
      .set({ caixaAnalysisStatus: status })
      .where(eq(process.id, processId))
  } catch (error) {
    console.error('Falha ao gravar caixaAnalysisStatus', { processId, error })
  }
}

// Arquivos correntes (isCurrent) dos termos da Caixa anexados ao processo.
async function getCurrentTermoFiles(processId: string) {
  return db
    .select({
      documentKey: processDocumentType.key,
      fileId: processDocumentFile.id,
      bucketName: processDocumentFile.bucketName,
      objectKey: processDocumentFile.objectKey,
      mimeType: processDocumentFile.mimeType,
      revision: processDocumentFile.revision,
    })
    .from(processDocumentFile)
    .innerJoin(
      processDocument,
      eq(processDocumentFile.processDocumentId, processDocument.id),
    )
    .innerJoin(
      processDocumentType,
      eq(processDocument.documentTypeId, processDocumentType.id),
    )
    .where(
      and(
        eq(processDocument.processId, processId),
        eq(processDocumentFile.isCurrent, true),
        inArray(processDocumentType.key, [...CAIXA_DOC_KEYS]),
      ),
    )
}

type DocExtraction = {
  documentKey: string
  fileId: string
  revision: number
  titular: string | null
  cpfTitular: string | null
  conjuge: string | null
  cpfConjuge: string | null
  trechoFonte: string | null
}

// Executa a analise (detached). Le os termos do S3, extrai (IA), compara
// (deterministico) e grava evidencia + (se aplicavel) ownerType + historico +
// status, tudo numa transacao. Nunca lanca para fora.
async function runCaixaOwnerAnalysisOnce(input: {
  processId: string
  triggeredByUserId: string | null
  startedAt: number
}): Promise<void> {
  const startedAt = input.startedAt
  const triggerSource: 'system' | 'user' = input.triggeredByUserId
    ? 'user'
    : 'system'

  try {
    const [proc] = await db
      .select({
        fullName: process.fullName,
        cpf: process.cpf,
        ownerType: process.ownerType,
        ownerTypeSource: process.ownerTypeSource,
      })
      .from(process)
      .where(eq(process.id, input.processId))
      .limit(1)

    if (!proc) {
      await setCaixaStatus(input.processId, 'error')
      return
    }

    const files = await getCurrentTermoFiles(input.processId)
    if (files.length === 0) {
      // Nenhum termo anexado — nada a analisar.
      await setCaixaStatus(input.processId, 'idle')
      return
    }

    const apiKey = (await getAnthropicApiKey()) ?? env.anthropic.apiKey
    if (!apiKey) {
      await recordAiAnalysis({
        kind: 'caixa_owner',
        processId: input.processId,
        model: env.anthropic.model,
        promptVersion: PROMPT_VERSION,
        status: 'error',
        errorMessage: 'Chave da Anthropic nao configurada.',
        durationMs: Date.now() - startedAt,
        triggerSource,
        triggeredByUserId: input.triggeredByUserId,
      })
      await setCaixaStatus(input.processId, 'error')
      return
    }

    const byDoc: DocExtraction[] = []
    const errors: string[] = []
    let model = env.anthropic.model
    let tokensInput = 0
    let tokensOutput = 0

    for (const file of files) {
      try {
        const bytes = await getStorageObjectBytes({
          bucketName: file.bucketName,
          objectKey: file.objectKey,
        })
        const base64 = Buffer.from(bytes).toString('base64')
        const extraction = await extractCaixaOwner({
          apiKey,
          model: env.anthropic.model,
          base64,
          mediaType: file.mimeType || 'application/pdf',
        })
        model = extraction.model
        if (extraction.usage) {
          tokensInput += extraction.usage.inputTokens
          tokensOutput += extraction.usage.outputTokens
        }
        byDoc.push({
          documentKey: file.documentKey,
          fileId: file.fileId,
          revision: file.revision,
          titular: extraction.titular,
          cpfTitular: extraction.cpfTitular,
          conjuge: extraction.conjuge,
          cpfConjuge: extraction.cpfConjuge,
          trechoFonte: extraction.trechoFonte,
        })
        // Os dados do termo (titular/conjuge = 1o/2o comprador) seguem em byDoc,
        // que vira a evidencia caixa_owner e alimenta o fato termoCompradores.
      } catch (error) {
        errors.push(
          `${file.documentKey}: ${error instanceof Error ? error.message : 'falha'}`,
        )
      }
    }

    // Todas as extracoes falharam -> registra erro (evidencia) e marca erro.
    if (byDoc.length === 0) {
      await recordAiAnalysis({
        kind: 'caixa_owner',
        processId: input.processId,
        model,
        promptVersion: PROMPT_VERSION,
        status: 'error',
        errorMessage: errors.join(' | ').slice(0, 500),
        durationMs: Date.now() - startedAt,
        triggerSource,
        triggeredByUserId: input.triggeredByUserId,
      })
      await setCaixaStatus(input.processId, 'error')
      return
    }

    // Evidencia da EXTRACAO do termo (alimenta o fato termoCompradores do v3). A
    // DECISAO do ownerType e do status e delegada ao reconciliador v3
    // (reconcileOwnerType) — fonte unica, modelo de 2 estados e quitacao correta.
    await recordAiAnalysis({
      kind: 'caixa_owner',
      processId: input.processId,
      context: {
        documentKey: byDoc[0].documentKey,
        fileId: byDoc[0].fileId,
        revision: byDoc[0].revision,
      },
      model,
      promptVersion: PROMPT_VERSION,
      input: {
        titular: { fullName: proc.fullName, cpf: proc.cpf },
        docs: byDoc.map((d) => ({
          documentKey: d.documentKey,
          fileId: d.fileId,
          revision: d.revision,
        })),
      },
      output: { byDoc, partialErrors: errors.length ? errors : undefined },
      status: 'ok',
      tokensInput: tokensInput || null,
      tokensOutput: tokensOutput || null,
      durationMs: Date.now() - startedAt,
      triggerSource,
      triggeredByUserId: input.triggeredByUserId,
    })

    await reconcileOwnerType({
      processId: input.processId,
      triggeredByUserId: input.triggeredByUserId,
    })
  } catch (error) {
    console.error('Falha na analise do contrato Caixa', {
      processId: input.processId,
      error,
    })
    await setCaixaStatus(input.processId, 'error')
  }
}

// Coalescing: re-dispara a analise UMA vez se um termo da Caixa foi anexado
// DURANTE a execucao (um gatilho concorrente teria retornado 'busy' e sido
// descartado, deixando o novo termo sem analise). Converge: cada re-disparo
// avanca o startedAt, entao o termo recem-anexado nao satisfaz mais a condicao.
async function rerunIfNewerTermo(
  input: { processId: string; triggeredByUserId: string | null },
  startedAt: number,
): Promise<void> {
  try {
    const newer = await db
      .select({ id: processDocumentFile.id })
      .from(processDocumentFile)
      .innerJoin(
        processDocument,
        eq(processDocumentFile.processDocumentId, processDocument.id),
      )
      .innerJoin(
        processDocumentType,
        eq(processDocument.documentTypeId, processDocumentType.id),
      )
      .where(
        and(
          eq(processDocument.processId, input.processId),
          eq(processDocumentFile.isCurrent, true),
          inArray(processDocumentType.key, [...CAIXA_DOC_KEYS]),
          gt(processDocumentFile.uploadedAt, new Date(startedAt)),
        ),
      )
      .limit(1)

    if (newer.length > 0) {
      await startCaixaOwnerAnalysis(input)
    }
  } catch (error) {
    console.error('Falha ao checar re-analise por novo termo', {
      processId: input.processId,
      error,
    })
  }
}

// Executa a analise e, ao terminar, re-dispara se um termo novo chegou durante a
// execucao (ver rerunIfNewerTermo).
async function runCaixaOwnerAnalysis(input: {
  processId: string
  triggeredByUserId: string | null
}): Promise<void> {
  const startedAt = Date.now()
  await runCaixaOwnerAnalysisOnce({ ...input, startedAt })
  await rerunIfNewerTermo(input, startedAt)
}

// Ponto de entrada: reivindica e dispara a analise em background (apos a
// resposta HTTP). Idempotente — se ja ha um job rodando, nao dispara outro.
export async function startCaixaOwnerAnalysis(input: {
  processId: string
  triggeredByUserId: string | null
}): Promise<{ status: 'processing' | 'busy' }> {
  const claimed = await claimCaixaAnalysis(input.processId)
  if (!claimed) {
    return { status: 'busy' }
  }

  void runCaixaOwnerAnalysis(input)
  return { status: 'processing' }
}
