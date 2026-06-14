import { recordAiAnalysis } from '../ai-analysis/ai-analysis.service'
import type { ExtractionMeta } from './processes.extraction.types'

// Versao do prompt/contrato de classificacao. Subir quando a Tarefa 2 do SYSTEM
// (tipos de documento) mudar de forma relevante — permite comparar decisoes
// entre versoes na auditoria.
export const DOCUMENT_EXTRACTION_PROMPT_VERSION = 'document_extraction@2'

// Desfecho do anexo (subconjunto do retorno de importDocumentBundle) — a DECISAO
// deterministica derivada da classificacao: o que foi anexado e o que foi pulado.
type ImportOutcome = {
  attached: Array<{ documentTypeKey: string; pageCount: number }>
  skipped: Array<{ documentTypeKey: string; reason: string }>
}

// Grava UMA linha de evidencia (ai_analysis kind document_extraction) para a
// classificacao de paginas de um PDF de lote: o que a IA retornou (paginas ->
// tipo) e a decisao derivada (anexado/pulado). Best-effort: a auditoria NUNCA
// pode derrubar o anexo dos documentos — engole o erro e apenas loga.
export async function recordDocumentExtractionAudit(input: {
  processId: string
  fileId: string
  totalPages: number
  meta: ExtractionMeta
  outcome: ImportOutcome
  durationMs: number
  triggeredByUserId: string | null
}): Promise<void> {
  try {
    await recordAiAnalysis({
      kind: 'document_extraction',
      processId: input.processId,
      // Referencia (nao os bytes) do PDF de lote classificado.
      context: { fileId: input.fileId },
      model: input.meta.model,
      promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
      // totalPages = paginas REAIS do PDF; classifiedPages = quantas a IA devolveu.
      // A diferenca expoe paginas OMITIDAS pela IA (total - classificadas). As
      // paginas nao_identificado vivem em output.paginas (nem anexam nem pulam).
      input: {
        fileId: input.fileId,
        totalPages: input.totalPages,
        classifiedPages: input.meta.paginas.length,
      },
      // Saida crua da IA: classificacao das paginas + extracao por papel (v3:
      // outorgantes da procuracao e partes do contrato de compra e venda) — fonte
      // dos fatos da derivacao de ownerType/quitacao.
      output: {
        paginas: input.meta.paginas,
        outorgantes: input.meta.outorgantes,
        compraVenda: input.meta.compraVenda,
      },
      // Decisao deterministica: o que o desmembramento anexou x pulou.
      decision: {
        attached: input.outcome.attached,
        skipped: input.outcome.skipped,
      },
      status: 'ok',
      tokensInput: input.meta.usage?.inputTokens ?? null,
      tokensOutput: input.meta.usage?.outputTokens ?? null,
      durationMs: input.durationMs,
      // A digitalizacao/reanalise e sempre disparada por um humano (upload/clique).
      triggerSource: 'user',
      triggeredByUserId: input.triggeredByUserId,
    })
  } catch (error) {
    console.error('document_extraction: falha ao gravar auditoria de IA', {
      processId: input.processId,
      fileId: input.fileId,
      error: String(error),
    })
  }
}
