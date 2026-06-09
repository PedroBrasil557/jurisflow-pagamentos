import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  getAuthenticatedUser,
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  assertCan,
  resolveUserPermissions,
} from '../permissions/permissions.service'
import {
  deleteBatchFile,
  downloadAllBatchFiles,
  downloadAllBatchFilesZip,
  getBatchFileDownload,
  listBatchFiles,
  maxBatchFileSizeInBytes,
  startBatchFileSplit,
  startScanIngestion,
  uploadBatchFiles,
} from './processes.batch.service'
import {
  deleteChecklistFile,
  downloadAllChecklistFiles,
  downloadAllChecklistFilesZip,
  getProcessChecklist,
  getProcessChecklistFileDownload,
  submitProcessChecklistItem,
  uploadProcessChecklistFile,
} from './processes.checklist.service'
import {
  extractDocumentsFromFiles,
  MAX_FILE_SIZE_IN_BYTES,
} from './processes.extraction.service'
import {
  importBundleDocumentsSchema,
  importDocumentBundle,
} from './processes.import.service'
import {
  generateProcessPdf,
  listProcessPdfModels,
} from './processes.pdf.service'
import {
  cancelProcessPayloadSchema,
  createProcessPayloadSchema,
  listProcessesQuerySchema,
  processBatchFileParamsSchema,
  processChecklistFileParamsSchema,
  processChecklistItemParamsSchema,
  processIdParamsSchema,
  processPdfModelParamsSchema,
  setDocumentationAssigneePayloadSchema,
  startProcessPayloadSchema,
  submitChecklistItemFormSchema,
  updateLegalProcessPayloadSchema,
  updateProcessPayloadSchema,
} from './processes.schemas'
import {
  cancelProcess,
  createDraftProcess,
  createProcess,
  deleteProcess,
  finalizeProcess,
  getProcessById,
  getProcessHistory,
  listProcesses,
  markProcessDocumentationReady,
  removeDocumentationAssignee,
  setDocumentationAssignee,
  startProcess,
  updateLegalProcess,
  updateProcess,
} from './processes.service'

async function getCurrentUserWithPermissions(c: Context<AppBindings>) {
  const currentUser = getAuthenticatedUser(c)
  const perms = await resolveUserPermissions(currentUser.id, currentUser.role)

  return { currentUser, perms }
}

// Guard de tamanho ANTES de bufferizar o corpo (c.req.raw.formData()): rejeita
// pelo Content-Length, ou aborta o stream se ausente — evita DoS por upload
// gigante. O overhead cobre o framing multipart sobre o limite por arquivo de
// cada rota (a checagem fina por arquivo, no service, da a mensagem precisa).
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

function uploadBodyLimit(maxFileBytes: number) {
  return bodyLimit({
    maxSize: maxFileBytes + MULTIPART_OVERHEAD_BYTES,
    onError: (c) =>
      c.json({ message: 'O arquivo enviado excede o tamanho permitido.' }, 413),
  })
}

export const processRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get('/', queryValidator(listProcessesQuerySchema), async (c) => {
    try {
      const { currentUser, perms } = await getCurrentUserWithPermissions(c)
      const result = await listProcesses(
        c.req.valid('query'),
        currentUser.id,
        perms,
      )

      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/', jsonValidator(createProcessPayloadSchema), async (c) => {
    try {
      const { currentUser, perms } = await getCurrentUserWithPermissions(c)
      const result = await createProcess(
        c.req.valid('json'),
        currentUser,
        perms,
      )

      return c.json(
        {
          process: result,
        },
        201,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/extract-documents',
    uploadBodyLimit(MAX_FILE_SIZE_IN_BYTES),
    async (c) => {
      const formData = await c.req.raw.formData()
      const files: File[] = []

      for (const value of formData.getAll('files')) {
        if (value instanceof File) {
          files.push(value)
        }
      }

      if (files.length === 0) {
        return c.json({ message: 'Informe ao menos um documento.' }, 400)
      }

      try {
        const { perms } = await getCurrentUserWithPermissions(c)
        assertCan(perms, 'create')

        const result = await extractDocumentsFromFiles(files)

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post('/scan', uploadBodyLimit(maxBatchFileSizeInBytes), async (c) => {
    const formData = await c.req.raw.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return c.json({ message: 'Informe o arquivo do documento.' }, 400)
    }

    try {
      const { currentUser, perms } = await getCurrentUserWithPermissions(c)
      assertCan(perms, 'create')
      // A digitalizacao anexa documentos no checklist: exige a permissao ANTES de
      // criar o rascunho, para nao deixar um processo que a ingestao nao completa.
      assertCan(perms, 'uploadChecklist')

      // Cria o rascunho primeiro; se a ingestao nao puder iniciar, faz rollback
      // (apaga o rascunho + scan) para nao deixar processo orfao.
      const draft = await createDraftProcess(currentUser, perms)

      try {
        const { batchFileId } = await startScanIngestion({
          processId: draft.id,
          file,
          actor: currentUser,
          perms,
        })

        return c.json({ processId: draft.id, batchFileId }, 202)
      } catch (error) {
        await deleteProcess(draft.id)
        throw error
      }
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/:processId/import-bundle',
    uploadBodyLimit(MAX_FILE_SIZE_IN_BYTES),
    paramsValidator(processIdParamsSchema),
    async (c) => {
      const formData = await c.req.raw.formData()
      const file = formData.get('file')
      const documentsRaw = formData.get('documents')

      if (!(file instanceof File)) {
        return c.json({ message: 'Informe o arquivo PDF.' }, 400)
      }

      if (typeof documentsRaw !== 'string') {
        return c.json(
          { message: 'Informe a classificacao dos documentos.' },
          400,
        )
      }

      let parsedDocuments: unknown
      try {
        parsedDocuments = JSON.parse(documentsRaw)
      } catch {
        return c.json({ message: 'Classificacao de documentos invalida.' }, 400)
      }

      const documents = importBundleDocumentsSchema.safeParse(parsedDocuments)
      if (!documents.success) {
        return c.json({ message: 'Classificacao de documentos invalida.' }, 400)
      }

      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await importDocumentBundle({
          processId: c.req.valid('param').processId,
          file,
          documents: documents.data,
          actor: currentUser,
          perms,
        })

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/checklist',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await getProcessChecklist(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/checklist/:processDocumentId/submit',
    paramsValidator(processChecklistItemParamsSchema),
    zValidator('form', submitChecklistItemFormSchema),
    async (c) => {
      const formData = c.req.valid('form')
      const fileValue = formData.file
      const observationValue = formData.observation
      const markOkWithoutFileValue = formData.markOkWithoutFile

      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await submitProcessChecklistItem({
          processId: c.req.valid('param').processId,
          processDocumentId: c.req.valid('param').processDocumentId,
          actor: currentUser,
          perms,
          file: fileValue instanceof File ? fileValue : null,
          observation: observationValue,
          markOkWithoutFile:
            typeof markOkWithoutFileValue === 'string'
              ? ['1', 'on', 'sim', 'true'].includes(
                  markOkWithoutFileValue.toLowerCase(),
                )
              : false,
        })

        return c.json(
          {
            checklist: {
              items: result.items,
              summary: result.summary,
            },
            message: result.message,
            process: result.process,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/checklist/:processDocumentId/files',
    paramsValidator(processChecklistItemParamsSchema),
    async (c) => {
      const formData = await c.req.raw.formData()
      const file = formData.get('file')

      if (!(file instanceof File)) {
        return c.json(
          {
            message: 'Informe o arquivo do checklist.',
          },
          400,
        )
      }

      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await uploadProcessChecklistFile({
          processId: c.req.valid('param').processId,
          processDocumentId: c.req.valid('param').processDocumentId,
          file,
          actor: currentUser,
          perms,
        })

        return c.json(
          {
            checklist: {
              items: result.items,
              summary: result.summary,
            },
            message: result.message,
          },
          201,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/checklist/:processDocumentId/files/:fileId/download',
    paramsValidator(processChecklistFileParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await getProcessChecklistFileDownload({
          ...c.req.valid('param'),
          userId: currentUser.id,
          perms,
        })

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete(
    '/:processId/checklist/:processDocumentId/files/:fileId',
    paramsValidator(processChecklistFileParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await deleteChecklistFile({
          ...c.req.valid('param'),
          actor: currentUser,
          perms,
        })

        return c.json(
          {
            checklist: {
              items: result.items,
              summary: result.summary,
            },
            message: result.message,
            process: result.process,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/batch/upload',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      const formData = await c.req.raw.formData()
      const files: File[] = []

      for (const value of formData.getAll('files')) {
        if (value instanceof File) {
          files.push(value)
        }
      }

      if (files.length === 0) {
        return c.json({ message: 'Informe ao menos um arquivo.' }, 400)
      }

      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await uploadBatchFiles({
          processId: c.req.valid('param').processId,
          files,
          actor: currentUser,
          perms,
        })

        return c.json(result, 201)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/batch',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const files = await listBatchFiles(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return c.json({ files }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete(
    '/:processId/batch/:fileId',
    paramsValidator(processBatchFileParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await deleteBatchFile({
          processId: c.req.valid('param').processId,
          fileId: c.req.valid('param').fileId,
          actor: currentUser,
          perms,
        })

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/batch/:fileId/split',
    paramsValidator(processBatchFileParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await startBatchFileSplit({
          processId: c.req.valid('param').processId,
          fileId: c.req.valid('param').fileId,
          actor: currentUser,
          perms,
        })

        // 202: desmembramento iniciado em segundo plano; status via listagem de lote.
        return c.json(result, 202)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/batch/:fileId/download',
    paramsValidator(processBatchFileParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await getBatchFileDownload({
          processId: c.req.valid('param').processId,
          fileId: c.req.valid('param').fileId,
          userId: currentUser.id,
          perms,
        })

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/batch/download-all',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await downloadAllBatchFiles(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/checklist/download-all',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await downloadAllChecklistFiles(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/checklist/download-all.zip',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { bytes, fileName } = await downloadAllChecklistFilesZip(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Disposition': `attachment; filename="${fileName}"`,
          },
        })
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/batch/download-all.zip',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { bytes, fileName } = await downloadAllBatchFilesZip(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Disposition': `attachment; filename="${fileName}"`,
          },
        })
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/pdf/models',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await listProcessPdfModels(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
        )

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/pdf/models/:modelKey/generate',
    paramsValidator(processPdfModelParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await generateProcessPdf({
          processId: c.req.valid('param').processId,
          modelKey: c.req.valid('param').modelKey,
          actor: currentUser,
          perms,
        })

        return c.json(result, 201)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/history',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const cursor = c.req.query('cursor') || undefined
        const limit = c.req.query('limit')
          ? Number(c.req.query('limit'))
          : undefined
        const result = await getProcessHistory(
          c.req.valid('param').processId,
          currentUser.id,
          perms,
          {
            cursor,
            limit,
          },
        )

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/mark-documentation-ready',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await markProcessDocumentationReady(
          c.req.valid('param').processId,
          currentUser,
          perms,
        )

        return c.json(
          {
            process: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/start',
    paramsValidator(processIdParamsSchema),
    jsonValidator(startProcessPayloadSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await startProcess(
          c.req.valid('param').processId,
          currentUser,
          c.req.valid('json'),
          perms,
        )

        return c.json(
          {
            process: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .patch(
    '/:processId/legal',
    paramsValidator(processIdParamsSchema),
    jsonValidator(updateLegalProcessPayloadSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await updateLegalProcess(
          c.req.valid('param').processId,
          currentUser,
          c.req.valid('json'),
          perms,
        )

        return c.json(
          {
            process: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/finalize',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await finalizeProcess(
          c.req.valid('param').processId,
          currentUser,
          perms,
        )

        return c.json(
          {
            process: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:processId/cancel',
    paramsValidator(processIdParamsSchema),
    jsonValidator(cancelProcessPayloadSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await cancelProcess(
          c.req.valid('param').processId,
          currentUser,
          c.req.valid('json'),
          perms,
        )

        return c.json(
          {
            process: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get('/:processId', paramsValidator(processIdParamsSchema), async (c) => {
    try {
      const { currentUser, perms } = await getCurrentUserWithPermissions(c)
      const result = await getProcessById(
        c.req.valid('param').processId,
        currentUser.id,
        perms,
      )

      return c.json(
        {
          process: result,
        },
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .put(
    '/:processId/documentation-assignee',
    requireRole('admin'),
    paramsValidator(processIdParamsSchema),
    jsonValidator(setDocumentationAssigneePayloadSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        const result = await setDocumentationAssignee(
          c.req.valid('param').processId,
          c.req.valid('json').assigneeUserId,
          currentUser.id,
        )
        return c.json({ process: result }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete(
    '/:processId/documentation-assignee',
    requireRole('admin'),
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        const result = await removeDocumentationAssignee(
          c.req.valid('param').processId,
          currentUser.id,
        )
        return c.json({ process: result }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .patch(
    '/:processId',
    paramsValidator(processIdParamsSchema),
    jsonValidator(updateProcessPayloadSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await updateProcess(
          c.req.valid('param').processId,
          c.req.valid('json'),
          currentUser,
          perms,
        )

        return c.json(
          {
            process: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
