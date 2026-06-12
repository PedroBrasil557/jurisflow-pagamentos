import { and, eq, lt, ne, or, sql } from 'drizzle-orm'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { getStorageObjectBytes } from '../../shared/storage/s3'
import { recordAiAnalysis } from '../ai-analysis/ai-analysis.service'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import {
  getAnthropicApiKey,
  getProcuracaoConjuntoAutoApply,
} from '../settings/settings.service'
import {
  type CaixaBuyer,
  compareCaixaOwner,
} from './processes.caixa-owner.compare'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  type ConjuntoMatchResult,
  type ConjuntoRecord,
  decideProcuracaoConjuntoOutcome,
  matchConjuntoInAddress,
} from './processes.procuracao-conjunto.compare'
import { extractProcuracaoConjunto } from './processes.procuracao-conjunto.helper'
import {
  process,
  processDocument,
  processDocumentFile,
  processDocumentType,
} from './processes.schema'

const PROCURACAO_DOC_KEY = 'procuracao_advogado'
const SYSTEM_ACTOR_ID = 'jurisflow-bot'
const PROMPT_VERSION = 'procuracao_conjunto@1'
const STALE_MINUTES = 10

export function isProcuracaoDocKey(key: string): boolean {
  return key === PROCURACAO_DOC_KEY
}

// Reivindica o job atomicamente (so um por vez); stale-aware pelo heartbeat.
async function claimProcuracaoAnalysis(processId: string): Promise<boolean> {
  const claimed = await db
    .update(process)
    .set({
      procuracaoConjuntoStatus: 'processing',
      procuracaoConjuntoStartedAt: sql`now()`,
    })
    .where(
      and(
        eq(process.id, processId),
        or(
          ne(process.procuracaoConjuntoStatus, 'processing'),
          lt(
            process.procuracaoConjuntoStartedAt,
            sql`now() - interval '${sql.raw(String(STALE_MINUTES))} minutes'`,
          ),
        ),
      ),
    )
    .returning({ id: process.id })

  return claimed.length > 0
}

async function setStatus(
  processId: string,
  status: 'idle' | 'done' | 'review' | 'error',
): Promise<void> {
  try {
    await db
      .update(process)
      .set({ procuracaoConjuntoStatus: status })
      .where(eq(process.id, processId))
  } catch (error) {
    console.error('Falha ao gravar procuracaoConjuntoStatus', {
      processId,
      error,
    })
  }
}

// O arquivo corrente (isCurrent) da procuracao anexada ao processo.
async function getCurrentProcuracaoFile(processId: string) {
  const [file] = await db
    .select({
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
        eq(processDocumentType.key, PROCURACAO_DOC_KEY),
      ),
    )
    .limit(1)

  return file ?? null
}

// Executa a analise (detached). Le a procuracao do S3, extrai (IA), confirma que
// o outorgante e o titular do processo, casa o conjunto (deterministico) e grava
// evidencia + (se aplicavel) housingComplex + historico + status. Nunca lanca.
async function runProcuracaoConjuntoAnalysisOnce(input: {
  processId: string
  triggeredByUserId: string | null
  startedAt: number
}): Promise<void> {
  const triggerSource: 'system' | 'user' = input.triggeredByUserId
    ? 'user'
    : 'system'

  try {
    const [proc] = await db
      .select({
        fullName: process.fullName,
        cpf: process.cpf,
        housingComplex: process.housingComplex,
        housingComplexSource: process.housingComplexSource,
      })
      .from(process)
      .where(eq(process.id, input.processId))
      .limit(1)

    if (!proc) {
      await setStatus(input.processId, 'error')
      return
    }

    const file = await getCurrentProcuracaoFile(input.processId)
    if (!file) {
      await setStatus(input.processId, 'idle')
      return
    }

    const apiKey = (await getAnthropicApiKey()) ?? env.anthropic.apiKey
    if (!apiKey) {
      await recordAiAnalysis({
        kind: 'procuracao_conjunto',
        processId: input.processId,
        model: env.anthropic.model,
        promptVersion: PROMPT_VERSION,
        status: 'error',
        errorMessage: 'Chave da Anthropic nao configurada.',
        durationMs: Date.now() - input.startedAt,
        triggerSource,
        triggeredByUserId: input.triggeredByUserId,
      })
      await setStatus(input.processId, 'error')
      return
    }

    const autoApplyEnabled = await getProcuracaoConjuntoAutoApply()

    let extraction: Awaited<ReturnType<typeof extractProcuracaoConjunto>>
    try {
      const bytes = await getStorageObjectBytes({
        bucketName: file.bucketName,
        objectKey: file.objectKey,
      })
      const base64 = Buffer.from(bytes).toString('base64')
      extraction = await extractProcuracaoConjunto({
        apiKey,
        model: env.anthropic.model,
        base64,
        mediaType: file.mimeType || 'application/pdf',
      })
    } catch (error) {
      await recordAiAnalysis({
        kind: 'procuracao_conjunto',
        processId: input.processId,
        model: env.anthropic.model,
        promptVersion: PROMPT_VERSION,
        status: 'error',
        errorMessage: (error instanceof Error ? error.message : 'falha').slice(
          0,
          500,
        ),
        durationMs: Date.now() - input.startedAt,
        triggerSource,
        triggeredByUserId: input.triggeredByUserId,
      })
      await setStatus(input.processId, 'error')
      return
    }

    // Confirma que o OUTORGANTE e o titular do processo (reusa o comparador do
    // caixa-owner: outorgantes como "compradores" vs o titular do processo). So
    // confiamos no endereco se a procuracao e DESTE cliente.
    const outorgantesAsBuyers: CaixaBuyer[] = extraction.outorgantes
      .filter((o) => o.nome)
      .map((o) => ({ nome: o.nome as string, cpf: o.cpf }))
    // Sem camada de conjuge aqui: so confirmamos se o outorgante e o titular.
    const ownerConfirm = compareCaixaOwner(outorgantesAsBuyers, [], {
      fullName: proc.fullName,
      cpf: proc.cpf,
    })
    const ownerConfirmed = ownerConfirm.result === 'titular'

    const conjuntos: ConjuntoRecord[] = await db
      .select({
        id: housingComplex.id,
        name: housingComplex.name,
        city: housingComplex.city,
      })
      .from(housingComplex)

    // So casa se o outorgante foi confirmado E ha endereco; senao -> review.
    const matchResult: ConjuntoMatchResult =
      ownerConfirmed && extraction.endereco
        ? matchConjuntoInAddress(
            {
              addressText: extraction.endereco,
              addressCity: extraction.cidade,
            },
            conjuntos,
          )
        : { result: 'review', matchedBy: 'none' }

    const outcome = decideProcuracaoConjuntoOutcome({
      matchResult,
      currentHousingComplex: proc.housingComplex,
      housingComplexSource: proc.housingComplexSource,
      autoApplyEnabled,
    })

    await db.transaction(async (tx) => {
      const auditId = await recordAiAnalysis(
        {
          kind: 'procuracao_conjunto',
          processId: input.processId,
          context: {
            documentKey: PROCURACAO_DOC_KEY,
            fileId: file.fileId,
            revision: file.revision,
          },
          model: extraction.model,
          promptVersion: PROMPT_VERSION,
          input: {
            titular: { fullName: proc.fullName, cpf: proc.cpf },
            currentHousingComplex: proc.housingComplex,
            autoApplyEnabled,
          },
          output: {
            outorgantes: extraction.outorgantes,
            endereco: extraction.endereco,
            cidade: extraction.cidade,
            trechoFonte: extraction.trechoFonte,
            ownerConfirmed,
          },
          decision: {
            result: matchResult.result,
            matchedBy: matchResult.matchedBy,
            conjunto: matchResult.conjunto?.name ?? null,
            apply: outcome.apply,
            newHousingComplex: outcome.newHousingComplex ?? null,
            divergence: outcome.divergence,
          },
          status: 'ok',
          tokensInput: extraction.usage?.inputTokens ?? null,
          tokensOutput: extraction.usage?.outputTokens ?? null,
          durationMs: Date.now() - input.startedAt,
          triggerSource,
          triggeredByUserId: input.triggeredByUserId,
        },
        tx,
      )

      if (outcome.apply && outcome.newHousingComplex) {
        await tx
          .update(process)
          .set({
            housingComplex: outcome.newHousingComplex,
            // Vincula o FK do conjunto (invariante: texto e id andam juntos,
            // sempre apontando para um registro real). Sem isto, os documentos de
            // escopo de conjunto (housingComplexDocumentKeys) nao sao herdados.
            housingComplexId: matchResult.conjunto?.id ?? null,
            housingComplexSource: 'system',
            procuracaoConjuntoStatus: outcome.analysisStatus,
          })
          .where(eq(process.id, input.processId))
      } else {
        await tx
          .update(process)
          .set({ procuracaoConjuntoStatus: outcome.analysisStatus })
          .where(eq(process.id, input.processId))
      }

      if (outcome.historyEvent) {
        await createProcessHistoryEntry({
          processId: input.processId,
          actorUserId: SYSTEM_ACTOR_ID,
          eventType: outcome.historyEvent,
          notes: outcome.apply
            ? 'Conjunto preenchido automaticamente a partir da procuracao.'
            : outcome.divergence
              ? 'A procuracao indica um conjunto diferente do informado — conferir.'
              : 'A analise da procuracao precisa de revisao humana.',
          metadata: {
            aiAnalysisId: auditId,
            fromHousingComplex: proc.housingComplex,
            toHousingComplex: outcome.newHousingComplex ?? proc.housingComplex,
            matchedBy: matchResult.matchedBy,
          },
          executor: tx,
        })
      }
    })

    // Conjunto vinculado: reconcilia o status — os docs de escopo de conjunto
    // passam a ser herdados/obrigatorios, podendo completar a documentacao (e o
    // PRONTA exige conjunto vinculado). Import dinamico para evitar ciclo com
    // checklist.service. Falha aqui NAO marca a analise como erro.
    if (outcome.apply) {
      try {
        const { reconcileProcessStatus } = await import(
          './processes.checklist.service'
        )
        await reconcileProcessStatus(input.processId, {
          id: SYSTEM_ACTOR_ID,
        } as unknown as Parameters<typeof reconcileProcessStatus>[1])
      } catch (reconcileError) {
        console.error('Falha ao reconciliar status apos vincular conjunto', {
          processId: input.processId,
          error: String(reconcileError),
        })
      }
    }
  } catch (error) {
    console.error('Falha na analise da procuracao', {
      processId: input.processId,
      error,
    })
    await setStatus(input.processId, 'error')
  }
}

// Ponto de entrada: reivindica e dispara em background (apos a resposta HTTP).
// Idempotente — se ja ha um job rodando, nao dispara outro.
export async function startProcuracaoConjuntoAnalysis(input: {
  processId: string
  triggeredByUserId: string | null
}): Promise<{ status: 'processing' | 'busy' }> {
  const claimed = await claimProcuracaoAnalysis(input.processId)
  if (!claimed) {
    return { status: 'busy' }
  }

  const startedAt = Date.now()
  void runProcuracaoConjuntoAnalysisOnce({ ...input, startedAt })
  return { status: 'processing' }
}
