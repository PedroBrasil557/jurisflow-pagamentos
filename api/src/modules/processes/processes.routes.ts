import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  getAuthenticatedUser,
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import { logEvent } from '../../shared/observability/log'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  aiAnalysisDetailParamsSchema,
  aiAnalysisListQuerySchema,
  aiAnalysisProcessParamsSchema,
} from '../ai-analysis/ai-analysis.schemas'
import {
  getAiAnalysis,
  listAiAnalyses,
} from '../ai-analysis/ai-analysis.service'
import { requestQuitacaoRecheck } from '../caixa-quitacao/caixa-quitacao.service'
import {
  assertCan,
  resolveUserPermissions,
} from '../permissions/permissions.service'
import {
  completeDocumentImport,
  deleteBatchFile,
  downloadAllBatchFiles,
  downloadAllBatchFilesZip,
  getBatchFileDownload,
  listBatchFiles,
  maxBatchFileSizeInBytes,
  presignDocumentUploads,
  reprocessFailedIngestion,
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
  generateProcessPdf,
  listProcessPdfModels,
} from './processes.pdf.service'
import {
  reanalyzeCaixaOwner,
  reanalyzeProcuracaoConjunto,
} from './processes.reextract.service'
import {
  cancelProcessPayloadSchema,
  completeImportBodySchema,
  createProcessPayloadSchema,
  listProcessesQuerySchema,
  presignImportBodySchema,
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

// Cria um processo a partir de UM documento (PDF): rascunho + ingestao DURÁVEL e
// ASSÍNCRONA (a mesma do scan — salva no lote, extrai/classifica/anexa em
// background, splitStatus + polling). Reusado por POST /scan (câmera) e POST
// /import (upload de arquivo). Rollback do rascunho se a ingestao nao iniciar.
async function createProcessFromDocument(
  c: Context<AppBindings>,
  file: File,
  source: 'scan' | 'import',
) {
  const { currentUser, perms } = await getCurrentUserWithPermissions(c)
  assertCan(perms, 'create')
  // A ingestao anexa documentos no checklist: exige a permissao ANTES de criar o
  // rascunho, para nao deixar um processo que a ingestao nao completa.
  assertCan(perms, 'uploadChecklist')

  logEvent(`${source}.start`, {
    requestId: c.get('requestId'),
    userId: currentUser.id,
    fileName: file.name,
    fileSizeBytes: file.size,
  })

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
  .post('/scan', uploadBodyLimit(maxBatchFileSizeInBytes), async (c) => {
    const formData = await c.req.raw.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return c.json({ message: 'Informe o arquivo do documento.' }, 400)
    }

    try {
      return await createProcessFromDocument(c, file, 'scan')
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Importar documentos via upload PRE-ASSINADO S3: cria o rascunho e devolve
  // URLs assinadas. O browser sobe os PDFs DIRETO no S3 (sem passar pela API —
  // contorna o teto de 10MB do API Gateway), depois chama /import/complete.
  .post(
    '/import/presign',
    jsonValidator(presignImportBodySchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        assertCan(perms, 'create')
        assertCan(perms, 'uploadChecklist')
        const { files } = c.req.valid('json')

        logEvent('import.presign', {
          requestId: c.get('requestId'),
          userId: currentUser.id,
          fileCount: files.length,
          totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        })

        const draft = await createDraftProcess(currentUser, perms)
        try {
          const { uploads } = await presignDocumentUploads({
            processId: draft.id,
            files,
          })
          return c.json({ processId: draft.id, uploads }, 200)
        } catch (error) {
          await deleteProcess(draft.id)
          throw error
        }
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Conclui o import pre-assinado: registra os arquivos ja no S3 e dispara a
  // ingestao SEQUENCIAL (mesma do scan).
  .post(
    '/import/complete',
    jsonValidator(completeImportBodySchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId, files } = c.req.valid('json')
        const result = await completeDocumentImport({
          processId,
          files,
          actor: currentUser,
          perms,
        })
        return c.json(result, 202)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Reprocessa a ingestao dos documentos que falharam (continuidade quando a IA
  // falha) — re-roda a extracao/anexo do PDF que ja esta no lote.
  .post(
    '/:processId/reprocess-import',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId } = c.req.valid('param')
        const result = await reprocessFailedIngestion({
          processId,
          actor: currentUser,
          perms,
        })
        return c.json(result, 202)
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
        const result = await downloadAllChecklistFilesZip(
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
    '/:processId/batch/download-all.zip',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const result = await downloadAllBatchFilesZip(
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
  // Evidencia de IA do processo (camada generica de auditoria). Gate de acesso =
  // ver o processo (getProcessById aplica assertCanViewProcess).
  .get(
    '/:processId/ai-analyses',
    paramsValidator(aiAnalysisProcessParamsSchema),
    queryValidator(aiAnalysisListQuerySchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId } = c.req.valid('param')
        await getProcessById(processId, currentUser.id, perms)
        const { kind, limit } = c.req.valid('query')
        const items = await listAiAnalyses(processId, { kind, limit })
        return c.json({ items }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:processId/ai-analyses/:id',
    paramsValidator(aiAnalysisDetailParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId, id } = c.req.valid('param')
        await getProcessById(processId, currentUser.id, perms)
        const analysis = await getAiAnalysis(processId, id)
        return c.json({ analysis }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Reanalisa o contrato Caixa sob demanda (dispara o job em background).
  .post(
    '/:processId/caixa-owner/reanalyze',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId } = c.req.valid('param')
        await getProcessById(processId, currentUser.id, perms)
        // Acao com custo (IA): exige a permissao de gerir documentacao, nao so
        // visibilidade do processo.
        assertCan(perms, 'uploadChecklist')
        const result = await reanalyzeCaixaOwner({
          processId,
          triggeredByUserId: currentUser.id,
        })
        return c.json(result, 202)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Reanalisa a procuracao (conjunto) sob demanda (dispara o job em background).
  .post(
    '/:processId/procuracao-conjunto/reanalyze',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId } = c.req.valid('param')
        await getProcessById(processId, currentUser.id, perms)
        assertCan(perms, 'uploadChecklist')
        const result = await reanalyzeProcuracaoConjunto({
          processId,
          triggeredByUserId: currentUser.id,
        })
        return c.json(result, 202)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Reconsulta a quitacao na Caixa sob demanda (re-enfileira para o worker).
  .post(
    '/:processId/caixa-quitacao/reconsultar',
    paramsValidator(processIdParamsSchema),
    async (c) => {
      try {
        const { currentUser, perms } = await getCurrentUserWithPermissions(c)
        const { processId } = c.req.valid('param')
        await getProcessById(processId, currentUser.id, perms)
        // Aciona o worker RPA (custo): exige permissao de gerir documentacao.
        assertCan(perms, 'uploadChecklist')
        const result = await requestQuitacaoRecheck(processId)
        return c.json(result, 202)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
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
