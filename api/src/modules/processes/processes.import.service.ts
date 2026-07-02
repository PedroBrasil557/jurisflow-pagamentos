import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'
import { logErrorEvent, logEvent } from '../../shared/observability/log'
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
export async function importDocumentBundle(input: {
  processId: string
  file: File
  documents: ExtractedDocument[]
  actor: ProcessActor
  perms: ResolvedPermissions
  requestId?: string
}) {
  const { processId, file, documents, actor, perms } = input
  const requestId = input.requestId ?? '-'
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

    // Copia para um Uint8Array com ArrayBuffer proprio (BlobPart valido).
    const splitFile = new File(
      [new Uint8Array(split.bytes)],
      buildSplitFileName(split.documentTypeKey),
      { type: 'application/pdf' },
    )

    // Falha de um anexo nao deve abortar os demais: registra em `skipped`.
    const uploadStartedAt = performance.now()
    try {
      await uploadProcessChecklistFile({
        processId,
        processDocumentId,
        file: splitFile,
        actor,
        perms,
      })

      attached.push({
        documentTypeKey: split.documentTypeKey,
        pageCount: split.pageCount,
      })
      logEvent('import_bundle.attach', {
        requestId,
        processId,
        documentTypeKey: split.documentTypeKey,
        ok: true,
        ms: Math.round(performance.now() - uploadStartedAt),
      })
    } catch (error) {
      skipped.push({
        documentTypeKey: split.documentTypeKey,
        reason:
          error instanceof ServiceError
            ? error.message
            : 'falha ao anexar o documento',
      })
      logErrorEvent('import_bundle.attach_failed', {
        requestId,
        processId,
        documentTypeKey: split.documentTypeKey,
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
