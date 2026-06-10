import type {
  AiAnalysisContext,
  AiAnalysisInsert,
  AiAnalysisKind,
} from './ai-analysis.schema'

// Parte PURA (sem db/env) — isolada para ser testavel sem banco.
export type RecordAiAnalysisInput = {
  id?: string
  kind: AiAnalysisKind
  processId: string
  context?: AiAnalysisContext | null
  model: string
  promptVersion: string
  input?: Record<string, unknown> | null
  output?: Record<string, unknown> | null
  decision?: Record<string, unknown> | null
  confidence?: number | null
  status: 'ok' | 'error'
  errorMessage?: string | null
  tokensInput?: number | null
  tokensOutput?: number | null
  durationMs?: number | null
  triggerSource: 'system' | 'user'
  triggeredByUserId?: string | null
}

// Monta a linha a partir do input com defaults explicitos. Garante o contrato:
// shape fixo, sempre 1 linha (append-only), id gerado se ausente.
export function buildAiAnalysisRow(
  input: RecordAiAnalysisInput,
): AiAnalysisInsert {
  return {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    processId: input.processId,
    context: input.context ?? null,
    model: input.model,
    promptVersion: input.promptVersion,
    input: input.input ?? null,
    output: input.output ?? null,
    decision: input.decision ?? null,
    confidence: input.confidence ?? null,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    tokensInput: input.tokensInput ?? null,
    tokensOutput: input.tokensOutput ?? null,
    durationMs: input.durationMs ?? null,
    triggerSource: input.triggerSource,
    triggeredByUserId: input.triggeredByUserId ?? null,
  }
}
