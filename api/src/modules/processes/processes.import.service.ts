import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'
import type { AppBindings } from '../../shared/types/app'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import {
  getProcessChecklist,
  uploadProcessChecklistFile,
} from './processes.checklist.service'
import { documentDisplayNumberByKey } from './processes.documents'
import { SPLITTABLE_DOCUMENT_KEYS } from './processes.extraction.normalizer'
import { MAX_FILE_SIZE_IN_BYTES } from './processes.extraction.service'
import type { ExtractedDocument } from './processes.extraction.types'
import { splitPdfByDocuments } from './processes.pdf.splitter'

type ProcessActor = NonNullable<AppBindings['Variables']['user']>

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
}) {
  const { processId, file, documents, actor, perms } = input

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

  const checklist = await getProcessChecklist(processId, actor.id, perms)
  const itemIdByKey = new Map(
    checklist.items.map((item) => [item.documentType.key, item.id]),
  )

  const pdfBytes = new Uint8Array(await file.arrayBuffer())
  const splits = await splitPdfByDocuments(pdfBytes, documents)

  const attached: Array<{ documentTypeKey: string; pageCount: number }> = []
  const skipped: Array<{ documentTypeKey: string; reason: string }> = []

  for (const split of splits) {
    const processDocumentId = itemIdByKey.get(split.documentTypeKey)

    if (!processDocumentId) {
      skipped.push({
        documentTypeKey: split.documentTypeKey,
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
    } catch (error) {
      skipped.push({
        documentTypeKey: split.documentTypeKey,
        reason:
          error instanceof ServiceError
            ? error.message
            : 'falha ao anexar o documento',
      })
    }
  }

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
