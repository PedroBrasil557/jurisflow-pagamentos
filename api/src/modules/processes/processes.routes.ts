import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import {
  getAuthenticatedUser,
  requireAuth,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  deleteBatchFile,
  downloadAllBatchFiles,
  getBatchFileDownload,
  listBatchFiles,
  uploadBatchFiles,
} from './processes.batch.service'
import {
  deleteChecklistFile,
  downloadAllChecklistFiles,
  getProcessChecklist,
  getProcessChecklistFileDownload,
  submitProcessChecklistItem,
  uploadProcessChecklistFile,
} from './processes.checklist.service'
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
  startProcessPayloadSchema,
  submitChecklistItemFormSchema,
  updateLegalProcessPayloadSchema,
  updateProcessPayloadSchema,
} from './processes.schemas'
import {
  cancelProcess,
  createProcess,
  finalizeProcess,
  getProcessById,
  getProcessHistory,
  listProcesses,
  markProcessDocumentationReady,
  startProcess,
  updateLegalProcess,
  updateProcess,
} from './processes.service'

export const processRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get('/', queryValidator(listProcessesQuerySchema), async (c) => {
    try {
      const result = await listProcesses(c.req.valid('query'))

      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/', jsonValidator(createProcessPayloadSchema), async (c) => {
    try {
      const result = await createProcess(
        c.req.valid('json'),
        getAuthenticatedUser(c),
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
  .get(
    '/:processId/checklist',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const result = await getProcessChecklist(c.req.valid('param').processId)

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
        const result = await submitProcessChecklistItem({
          processId: c.req.valid('param').processId,
          processDocumentId: c.req.valid('param').processDocumentId,
          actor: getAuthenticatedUser(c),
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
        const result = await uploadProcessChecklistFile({
          processId: c.req.valid('param').processId,
          processDocumentId: c.req.valid('param').processDocumentId,
          file,
          actor: getAuthenticatedUser(c),
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
        const result = await getProcessChecklistFileDownload(
          c.req.valid('param'),
        )

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
        const result = await deleteChecklistFile({
          ...c.req.valid('param'),
          actor: getAuthenticatedUser(c),
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
        const result = await uploadBatchFiles({
          processId: c.req.valid('param').processId,
          files,
          actor: getAuthenticatedUser(c),
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
        const files = await listBatchFiles(c.req.valid('param').processId)

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
        const result = await deleteBatchFile({
          processId: c.req.valid('param').processId,
          fileId: c.req.valid('param').fileId,
          actor: getAuthenticatedUser(c),
        })

        return c.json(result, 200)
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
        const result = await getBatchFileDownload({
          processId: c.req.valid('param').processId,
          fileId: c.req.valid('param').fileId,
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
        const result = await downloadAllBatchFiles(
          c.req.valid('param').processId,
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
        const result = await downloadAllChecklistFiles(
          c.req.valid('param').processId,
        )

        return c.json(result, 200)
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
        const result = await listProcessPdfModels(
          c.req.valid('param').processId,
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
        const result = await generateProcessPdf({
          processId: c.req.valid('param').processId,
          modelKey: c.req.valid('param').modelKey,
          actor: getAuthenticatedUser(c),
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
        const cursor = c.req.query('cursor') || undefined
        const limit = c.req.query('limit')
          ? Number(c.req.query('limit'))
          : undefined
        const result = await getProcessHistory(c.req.valid('param').processId, {
          cursor,
          limit,
        })

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
        const result = await markProcessDocumentationReady(
          c.req.valid('param').processId,
          getAuthenticatedUser(c),
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
        const result = await startProcess(
          c.req.valid('param').processId,
          getAuthenticatedUser(c),
          c.req.valid('json'),
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
        const result = await updateLegalProcess(
          c.req.valid('param').processId,
          getAuthenticatedUser(c),
          c.req.valid('json'),
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
        const result = await finalizeProcess(
          c.req.valid('param').processId,
          getAuthenticatedUser(c),
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
        const result = await cancelProcess(
          c.req.valid('param').processId,
          getAuthenticatedUser(c),
          c.req.valid('json'),
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
      const result = await getProcessById(c.req.valid('param').processId)

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
  .patch(
    '/:processId',
    paramsValidator(processIdParamsSchema),
    jsonValidator(updateProcessPayloadSchema),
    async (c) => {
      try {
        const result = await updateProcess(
          c.req.valid('param').processId,
          c.req.valid('json'),
          getAuthenticatedUser(c),
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
