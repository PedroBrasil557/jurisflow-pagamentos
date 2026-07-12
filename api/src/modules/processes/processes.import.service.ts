import { z } from 'zod'
import { env } from '../../shared/config/env'
import { ServiceError } from '../../shared/errors/service-error'
import { logErrorEvent, logEvent } from '../../shared/observability/log'
import {
  enhanceFitPdf,
  isScanEnhanceEnabled,
} from '../../shared/scan-enhance/client'
import type { AppBindings } from '../../shared/types/app'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import {
  getChecklistSlotIdsByKey,
  uploadProcessChecklistFile,
} from './processes.checklist.service'
import { documentDisplayNumberByKey } from './processes.documents'
import { SPLITTABLE_DOCUMENT_KEYS } from './processes.extraction.normalizer'
import { MAX_FILE_SIZE_IN_BYTES } from './processes.extraction.service'
import type { ExtractedDocument } from './processes.extraction.types'
import { splitPdfByDocuments } from './processes.pdf.splitter'

// So o id do ator e usado (usuario autenticado OU bot do sistema na ingestao).
// Tipar so o id permite { id } sem cast e impede leitura de campo inexistente.
type ProcessActor = Pick<NonNullable<AppBindings['Variables']['user']>, 'id'>

export const importBundleDocumentsSchema = z.array(
  z.object({
    documentTypeKey: z.enum(SPLITTABLE_DOCUMENT_KEYS),
    label: z.string(),
    pages: z.array(z.number().int().positive()),
  }),
)

function buildSplitFileName(documentTypeKey: string) {
  const number = documentDisplayNumberByKey.get(documentTypeKey)
  const prefix = number ? `${number}-` : ''
  return `${prefix}${documentTypeKey}.pdf`
}

// Desmembra o PDF empacotado e anexa cada parte ao item de checklist do tipo.
// enhanceAndFit (scans): realca e encoda-para-caber cada parte no alvo de
// tamanho (<= CHECKLIST_FILE_MAX_BYTES) ANTES de anexar. Imports nato-digitais
// passam false (rasterizar degradaria) e sao anexados como saem do split.
export async function importDocumentBundle(input: {
  processId: string
  file: File
  documents: ExtractedDocument[]
  actor: ProcessActor
  perms: ResolvedPermissions
  requestId?: string
  enhanceAndFit?: boolean
}) {
  const { processId, file, documents, actor, perms } = input
  const requestId = input.requestId ?? '-'
  const enhanceAndFit = input.enhanceAndFit ?? false
  const startedAt = performance.now()

  logEvent('import_bundle.start', {
    requestId,
    processId,
    userId: actor.id,
    fileName: file.name,
    fileSizeBytes: file.size,
    docCount: documents.length,
  })

  if (file.type.toLowerCase() !== 'application/pdf') {
    throw new ServiceError(415, 'Envie um arquivo PDF.')
  }

  if (file.size === 0) {
    throw new ServiceError(400, 'O arquivo PDF esta vazio.')
  }

  if (file.size > MAX_FILE_SIZE_IN_BYTES) {
    throw new ServiceError(
      413,
      'O arquivo PDF excede o tamanho maximo de 32 MB.',
    )
  }

  // Slots de TODOS os tipos (inclui condicionais ocultos): um doc classificado pode
  // ser anexado ao seu slot ANTES de o ownerType ser derivado. Sem isto, a compra e
  // venda (slot condicional a nao_titular) era PULADA no import e nunca re-anexada.
  const itemIdByKey = await getChecklistSlotIdsByKey(processId)

  const pdfBytes = new Uint8Array(await file.arrayBuffer())
  const splitStartedAt = performance.now()
  const splits = await splitPdfByDocuments(pdfBytes, documents)
  logEvent('import_bundle.split', {
    requestId,
    processId,
    splitCount: splits.length,
    ms: Math.round(performance.now() - splitStartedAt),
  })

  const attached: Array<{ documentTypeKey: string; pageCount: number }> = []
  const skipped: Array<{ documentTypeKey: string; reason: string }> = []

  // Fase 1 (realce + encode-para-caber): produz os bytes finais de TODAS as
  // partes ANTES de anexar qualquer uma. O fit e FATAL (nao best-effort): se o
  // microservico estiver configurado e falhar, isto LANCA aqui — antes de
  // qualquer anexo — e a fila duravel re-executa o job limpo (nada anexado,
  // sem duplicar). E assim que "<= limite" vira invariante do artefato de scan.
  // Microservico desligado (dev) => enhanceFitPdf retorna null e segue com o
  // original (limite nao garantido, comportamento de opt-out).
  const prepared: Array<{
    documentTypeKey: string
    processDocumentId: string
    file: File
    pageCount: number
  }> = []

  for (const split of splits) {
    const processDocumentId = itemIdByKey.get(split.documentTypeKey)

    if (!processDocumentId) {
      skipped.push({
        documentTypeKey: split.documentTypeKey,
        reason: 'item de checklist nao encontrado',
      })
      logEvent('import_bundle.attach', {
        requestId,
        processId,
        documentTypeKey: split.documentTypeKey,
        ok: false,
        reason: 'item de checklist nao encontrado',
      })
      continue
    }

    let bytes: Uint8Array = split.bytes
    if (enhanceAndFit && isScanEnhanceEnabled()) {
      const fitStartedAt = performance.now()
      const fitted = await enhanceFitPdf(
        split.bytes,
        env.checklistFileMaxBytes,
      )
      if (fitted) {
        bytes = fitted.bytes
        logEvent('import_bundle.fit', {
          requestId,
          processId,
          documentTypeKey: split.documentTypeKey,
          bytesBefore: split.bytes.length,
          bytesAfter: fitted.bytes.length,
          ms: Math.round(performance.now() - fitStartedAt),
          metrics: fitted.metrics,
        })
      }
    }

    // Copia para um Uint8Array com ArrayBuffer proprio (BlobPart valido).
    prepared.push({
      documentTypeKey: split.documentTypeKey,
      processDocumentId,
      file: new File(
        [new Uint8Array(bytes)],
        buildSplitFileName(split.documentTypeKey),
        { type: 'application/pdf' },
      ),
      pageCount: split.pageCount,
    })
  }

  // Fase 2 (anexo): falha de um anexo nao deve abortar os demais (`skipped`).
  for (const item of prepared) {
    const uploadStartedAt = performance.now()
    try {
      await uploadProcessChecklistFile({
        processId,
        processDocumentId: item.processDocumentId,
        file: item.file,
        actor,
        perms,
      })

      attached.push({
        documentTypeKey: item.documentTypeKey,
        pageCount: item.pageCount,
      })
      logEvent('import_bundle.attach', {
        requestId,
        processId,
        documentTypeKey: item.documentTypeKey,
        ok: true,
        ms: Math.round(performance.now() - uploadStartedAt),
      })
    } catch (error) {
      skipped.push({
        documentTypeKey: item.documentTypeKey,
        reason:
          error instanceof ServiceError
            ? error.message
            : 'falha ao anexar o documento',
      })
      logErrorEvent('import_bundle.attach_failed', {
        requestId,
        processId,
        documentTypeKey: item.documentTypeKey,
        ms: Math.round(performance.now() - uploadStartedAt),
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  logEvent('import_bundle.done', {
    requestId,
    processId,
    attached: attached.length,
    skipped: skipped.length,
    totalMs: Math.round(performance.now() - startedAt),
  })

  const baseMessage =
    attached.length > 0
      ? `${attached.length} documento(s) anexado(s) ao checklist.`
      : 'Nenhum documento foi anexado ao checklist.'

  return {
    message:
      skipped.length > 0
        ? `${baseMessage} ${skipped.length} nao anexado(s).`
        : baseMessage,
    attached,
    skipped,
  }
}
