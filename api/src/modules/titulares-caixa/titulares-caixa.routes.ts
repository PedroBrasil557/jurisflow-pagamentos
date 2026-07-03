import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getAuthenticatedUser } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import { logEvent } from '../../shared/observability/log'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import { resolveUserPermissions } from '../permissions/permissions.service'
import type { ProfilePermissions } from '../permissions/permissions.types'
import { importTitularesFromXlsx } from './titulares-caixa.import.service'
import {
  exportTitularesQuerySchema,
  listTitularesQuerySchema,
  reconsultarPayloadSchema,
  titularDocumentoParamsSchema,
} from './titulares-caixa.schemas'
import {
  exportTitulares,
  getTitularDocumentBytes,
  getTitularDocumentDownloadUrl,
  getTitularDocumentInlineUrl,
  listEmpreendimentoOptions,
  listLogradouroOptions,
  listTitulares,
  reconsultarTitulares,
} from './titulares-caixa.service'
// Registra o handler do subject 'titular' na fila de quitacao (efeito colateral).
import './titulares-caixa.subject'

// Teto do upload da planilha (a lista atual ~1MB; folga para crescimento).
const MAX_XLSX_BYTES = 25 * 1024 * 1024
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

// Acesso liberado por permissao de perfil (grupo titularCaixa), nao por role
// fixa: 'view' cobre lista/filtros/termos; export, import e reconsultar tem
// flags proprias (dados sensiveis: CPF/PIS -> LGPD; import em massa). Sem
// bypass de admin aqui: as flags ja chegam resolvidas (master = tudo true;
// admin comum = do perfil atribuido).
function requireTitularCaixa(action: keyof ProfilePermissions['titularCaixa']) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user')
    if (!user) {
      return c.json({ message: 'Sessao invalida.' }, 401)
    }
    const perms = await resolveUserPermissions(user.id, user.role)
    if (!perms.permissions.titularCaixa[action]) {
      return c.json(
        { message: 'Voce nao tem permissao para acessar este recurso.' },
        403,
      )
    }
    await next()
  }
}

export const titularesCaixaRoutes = new Hono<AppBindings>()
  .get(
    '/',
    requireTitularCaixa('view'),
    queryValidator(listTitularesQuerySchema),
    async (c) => {
      try {
        const result = await listTitulares(c.req.valid('query'))
        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Export Excel (.xlsx) respeitando os filtros atuais da tela.
  .get(
    '/export',
    requireTitularCaixa('export'),
    queryValidator(exportTitularesQuerySchema),
    async (c) => {
      try {
        const bytes = await exportTitulares(c.req.valid('query'))
        const date = new Date().toISOString().slice(0, 10)
        c.header(
          'content-type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        c.header(
          'content-disposition',
          `attachment; filename="titulares-caixa-${date}.xlsx"`,
        )
        return c.body(bytes.slice().buffer as ArrayBuffer)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Opcoes distintas de empreendimento para o filtro multiselect.
  .get('/opcoes/empreendimento', requireTitularCaixa('view'), async (c) => {
    try {
      const result = await listEmpreendimentoOptions()
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Opcoes distintas de logradouro para o filtro multiselect.
  .get('/opcoes/logradouro', requireTitularCaixa('view'), async (c) => {
    try {
      const result = await listLogradouroOptions()
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post(
    '/import',
    requireTitularCaixa('import'),
    bodyLimit({
      maxSize: MAX_XLSX_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) =>
        c.json(
          { message: 'O arquivo enviado excede o tamanho permitido.' },
          413,
        ),
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
  .post(
    '/reconsultar',
    requireTitularCaixa('reconsultar'),
    jsonValidator(reconsultarPayloadSchema),
    async (c) => {
      try {
        const { ids } = c.req.valid('json')
        const result = await reconsultarTitulares(ids)
        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:id/documentos/:docId',
    requireTitularCaixa('view'),
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
    requireTitularCaixa('view'),
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
  // Conteudo (bytes) SAME-ORIGIN para o viewer de PDF (react-pdf/pdfjs) — evita
  // CORS/redirect ao MinIO. Cookie-auth.
  .get(
    '/:id/documentos/:docId/conteudo',
    requireTitularCaixa('view'),
    paramsValidator(titularDocumentoParamsSchema),
    async (c) => {
      try {
        const { id, docId } = c.req.valid('param')
        const doc = await getTitularDocumentBytes({ titularId: id, docId })
        c.header('content-type', doc.contentType || 'application/pdf')
        c.header('content-disposition', 'inline')
        c.header('cache-control', 'private, max-age=300')
        return c.body(doc.bytes.slice().buffer as ArrayBuffer)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
