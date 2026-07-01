import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  getAuthenticatedUser,
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
import { importTitularesFromXlsx } from './titulares-caixa.import.service'
import {
  listTitularesQuerySchema,
  reconsultarPayloadSchema,
  titularDocumentoParamsSchema,
} from './titulares-caixa.schemas'
import {
  getTitularDocumentDownloadUrl,
  getTitularDocumentInlineUrl,
  listEmpreendimentoOptions,
  listTitulares,
  reconsultarTitulares,
} from './titulares-caixa.service'
// Registra o handler do subject 'titular' na fila de quitacao (efeito colateral).
import './titulares-caixa.subject'

// Teto do upload da planilha (a lista atual ~1MB; folga para crescimento).
const MAX_XLSX_BYTES = 25 * 1024 * 1024
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

// Tela e acoes sao admin-only (dados sensiveis: CPF/PIS -> LGPD; import em massa).
export const titularesCaixaRoutes = new Hono<AppBindings>()
  .use('*', requireRole('admin'))
  .get('/', queryValidator(listTitularesQuerySchema), async (c) => {
    try {
      const result = await listTitulares(c.req.valid('query'))
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Opcoes distintas de empreendimento para o filtro multiselect.
  .get('/opcoes/empreendimento', async (c) => {
    try {
      const result = await listEmpreendimentoOptions()
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/import',
    bodyLimit({
      maxSize: MAX_XLSX_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) =>
        c.json({ message: 'O arquivo enviado excede o tamanho permitido.' }, 413),
    }),
    async (c) => {
      const user = getAuthenticatedUser(c)
      const formData = await c.req.raw.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return c.json({ message: 'Informe o arquivo .xlsx da planilha.' }, 400)
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = await importTitularesFromXlsx({
          bytes,
          userId: user.id,
        })
        logEvent('titulares.import.request', {
          userId: user.id,
          fileName: file.name,
          ...result,
          errors: result.errors.length,
        })
        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post('/reconsultar', jsonValidator(reconsultarPayloadSchema), async (c) => {
    try {
      const { ids } = c.req.valid('json')
      const result = await reconsultarTitulares(ids)
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get(
    '/:id/documentos/:docId',
    paramsValidator(titularDocumentoParamsSchema),
    async (c) => {
      try {
        const { id, docId } = c.req.valid('param')
        const url = await getTitularDocumentDownloadUrl({
          titularId: id,
          docId,
        })
        return c.redirect(url)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Preview inline (renderiza no navegador/iframe, sem forcar download).
  .get(
    '/:id/documentos/:docId/preview',
    paramsValidator(titularDocumentoParamsSchema),
    async (c) => {
      try {
        const { id, docId } = c.req.valid('param')
        const url = await getTitularDocumentInlineUrl({ titularId: id, docId })
        return c.redirect(url)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
