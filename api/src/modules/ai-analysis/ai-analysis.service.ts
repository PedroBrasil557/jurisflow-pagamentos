import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import {
  buildAiAnalysisRow,
  type RecordAiAnalysisInput,
} from './ai-analysis.row'
import { type AiAnalysisKind, aiAnalysis } from './ai-analysis.schema'

export {
  buildAiAnalysisRow,
  type RecordAiAnalysisInput,
} from './ai-analysis.row'

// Aceita o `db` ou uma transacao (tx) — assim o consumidor grava a evidencia na
// MESMA transacao da mutacao de negocio (atomicidade).
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

// Grava UMA linha de evidencia (append-only). Retorna o id gerado para o
// consumidor linkar (ex.: no evento de historico). Sem `finally`, sem decisao
// embutida — o consumidor faz a chamada de IA + decide e chama isto uma vez.
export async function recordAiAnalysis(
  input: RecordAiAnalysisInput,
  executor: Executor = db,
): Promise<string> {
  const row = buildAiAnalysisRow(input)
  await executor.insert(aiAnalysis).values(row)
  return row.id
}

// Colunas nao-PII para a LISTA (output/input/decision contem dados pessoais e so
// aparecem no detalhe).
const listColumns = {
  id: aiAnalysis.id,
  kind: aiAnalysis.kind,
  status: aiAnalysis.status,
  confidence: aiAnalysis.confidence,
  model: aiAnalysis.model,
  promptVersion: aiAnalysis.promptVersion,
  durationMs: aiAnalysis.durationMs,
  triggerSource: aiAnalysis.triggerSource,
  triggeredByUserId: aiAnalysis.triggeredByUserId,
  createdAt: aiAnalysis.createdAt,
}

export async function listAiAnalyses(
  processId: string,
  options: { kind?: string; limit: number },
) {
  const conditions = [eq(aiAnalysis.processId, processId)]
  if (options.kind) {
    conditions.push(eq(aiAnalysis.kind, options.kind as AiAnalysisKind))
  }

  return db
    .select(listColumns)
    .from(aiAnalysis)
    .where(and(...conditions))
    .orderBy(desc(aiAnalysis.createdAt))
    .limit(options.limit)
}

// IDOR-safe: filtra por (id E processId). 404 se nao casar — impede ler a
// evidencia de outro processo via /processes/A/ai-analyses/B.
export async function getAiAnalysis(processId: string, id: string) {
  const [row] = await db
    .select()
    .from(aiAnalysis)
    .where(and(eq(aiAnalysis.id, id), eq(aiAnalysis.processId, processId)))
    .limit(1)

  if (!row) {
    throw new ServiceError(404, 'Analise de IA nao encontrada.')
  }

  return row
}
