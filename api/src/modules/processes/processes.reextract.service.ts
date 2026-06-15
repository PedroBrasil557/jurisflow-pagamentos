import { and, eq } from 'drizzle-orm'
import { db } from '../../shared/db'
import { getStorageObjectBytes } from '../../shared/storage/s3'
import { reconcileOwnerType } from './derive/reconcile'
import { recordDocumentExtractionAudit } from './processes.extraction.audit'
import { extractDocumentsFromFiles } from './processes.extraction.service'
import { countPdfPages } from './processes.pdf.splitter'
import {
  processDocument,
  processDocumentFile,
  processDocumentType,
} from './processes.schema'

// Documentos cujo CONTEUDO alimenta a derivacao (ownerType / conjunto / quitacao):
// termos da Caixa, declaracao de quitacao e procuracao. Anexar/atualizar um desses
// FORA de um lote (upload manual ou anexo de sistema/RPA) dispara a RE-EXTRACAO por
// papel — UMA chamada de IA que ja extrai todos os papeis — + reconciliacao. Isto
// substitui as antigas analises detached caixa-owner e procuracao-conjunto.
const REEXTRACT_DOC_KEYS = [
  'termo_entrega_recebimento_imovel',
  'declaracao_quitacao',
  'procuracao_advogado',
] as const

export function isReextractDocKey(key: string): boolean {
  return (REEXTRACT_DOC_KEYS as readonly string[]).includes(key)
}

// Docs que comprovam o titular do contrato Caixa (card "Tipo de proprietario").
const CAIXA_CARD_KEYS = [
  'termo_entrega_recebimento_imovel',
  'declaracao_quitacao',
] as const

async function getCurrentFile(processId: string, documentTypeKey: string) {
  const [row] = await db
    .select({
      bucketName: processDocumentFile.bucketName,
      objectKey: processDocumentFile.objectKey,
      mimeType: processDocumentFile.mimeType,
      fileId: processDocumentFile.id,
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
        eq(processDocumentType.key, documentTypeKey),
      ),
    )
    .limit(1)
  return row ?? null
}

// Re-extrai (IA, por papel) o arquivo atual de um doc relevante e reconcilia. A
// extracao unica ja traz termoCompradores / outorgantes / endereco / compra-venda,
// que viram fatos via a auditoria document_extraction. Best-effort: nunca lanca (e
// chamada detached do anexo). Substitui caixa-owner + procuracao-conjunto.
export async function reextractDocAndReconcile(input: {
  processId: string
  documentTypeKey: string
  triggeredByUserId: string | null
}): Promise<void> {
  try {
    const current = await getCurrentFile(input.processId, input.documentTypeKey)
    // Sem arquivo corrente (ex.: removido): so reconcilia (idempotente).
    if (!current) {
      await reconcileOwnerType({
        processId: input.processId,
        triggeredByUserId: input.triggeredByUserId,
      })
      return
    }

    const startedAt = Date.now()
    const bytes = await getStorageObjectBytes({
      bucketName: current.bucketName,
      objectKey: current.objectKey,
    })
    const file = new File(
      [new Uint8Array(bytes)],
      `${input.documentTypeKey}.pdf`,
      { type: current.mimeType || 'application/pdf' },
    )
    const { meta } = await extractDocumentsFromFiles([file])

    // Grava a evidencia document_extraction (sem decisao de anexo — o doc ja esta
    // anexado no seu slot; aqui so extraimos os papeis para os fatos).
    await recordDocumentExtractionAudit({
      processId: input.processId,
      fileId: current.fileId,
      totalPages: await countPdfPages(new Uint8Array(bytes)),
      meta,
      outcome: { attached: [], skipped: [] },
      durationMs: Date.now() - startedAt,
      triggeredByUserId: input.triggeredByUserId,
    })

    await reconcileOwnerType({
      processId: input.processId,
      triggeredByUserId: input.triggeredByUserId,
    })
  } catch (error) {
    console.error('reextractDocAndReconcile: falha', {
      processId: input.processId,
      documentTypeKey: input.documentTypeKey,
      error: String(error),
    })
  }
}

async function firstAttachedKey(
  processId: string,
  keys: readonly string[],
): Promise<string | null> {
  for (const key of keys) {
    if (await getCurrentFile(processId, key)) {
      return key
    }
  }
  return null
}

// Reanalisa sob demanda (rota "reanalisar" do card Tipo de proprietario): re-extrai
// o termo/quitacao anexado e reconcilia, em background. Retorna 'processing' para
// preservar o contrato 202 da UI.
export async function reanalyzeCaixaOwner(input: {
  processId: string
  triggeredByUserId: string | null
}): Promise<{ status: 'processing' }> {
  const key = await firstAttachedKey(input.processId, CAIXA_CARD_KEYS)
  void reextractDocAndReconcile({
    processId: input.processId,
    documentTypeKey: key ?? CAIXA_CARD_KEYS[0],
    triggeredByUserId: input.triggeredByUserId,
  })
  return { status: 'processing' }
}

// Reanalisa sob demanda (rota "reanalisar" do card Conjunto): re-extrai a procuracao
// (endereco do outorgante) e reconcilia, em background.
export async function reanalyzeProcuracaoConjunto(input: {
  processId: string
  triggeredByUserId: string | null
}): Promise<{ status: 'processing' }> {
  void reextractDocAndReconcile({
    processId: input.processId,
    documentTypeKey: 'procuracao_advogado',
    triggeredByUserId: input.triggeredByUserId,
  })
  return { status: 'processing' }
}
