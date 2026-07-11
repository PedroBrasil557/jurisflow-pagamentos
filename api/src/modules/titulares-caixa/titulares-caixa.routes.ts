import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  getAuthenticatedUser,
  requireAuth,
} from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import { logEvent } from '../../shared/observability/log'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import { requirePermission } from '../permissions/permissions.middleware'
import {
  assertTitularCaixaCan,
  resolveUserPermissions,
} from '../permissions/permissions.service'
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
  listConjuntoOptions,
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

// Acesso por permissao de perfil (grupo titularCaixa), nao por role fixa. As rotas
// que retornam/derivam dados de titular resolvem perms UMA vez no handler (padrao do
// dashboard: requireAuth + assertTitularCaixaCan) e repassam ao service, que aplica o
// recorte por conjunto (buildTitularesVisibilityFilter). Assim lista, export, opcoes,
// DOCUMENTO e RECONSULTA respeitam o MESMO recorte — sem duplo-resolve de perms.
// Flags: 'view' cobre lista/filtros/termos; export/import/reconsultar tem flag propria
// (dados sensiveis: CPF/PIS -> LGPD; import em massa).
export const titularesCaixaRoutes = new Hono<AppBindings>()
  .use(requireAuth())
  .get('/', queryValidator(listTitularesQuerySchema), async (c) => {
    try {
      const user = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(user.id, user.role)
      assertTitularCaixaCan(perms, 'view')
      const result = await listTitulares(c.req.valid('query'), perms)
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Export Excel (.xlsx) respeitando os filtros atuais da tela.
  .get('/export', queryValidator(exportTitularesQuerySchema), async (c) => {
    try {
      const user = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(user.id, user.role)
      assertTitularCaixaCan(perms, 'export')
      const bytes = await exportTitulares(c.req.valid('query'), perms)
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
  })
  // Opcoes distintas de empreendimento para o filtro multiselect.
  .get('/opcoes/empreendimento', async (c) => {
    try {
      const user = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(user.id, user.role)
      assertTitularCaixaCan(perms, 'view')
      const result = await listEmpreendimentoOptions(perms)
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Opcoes distintas de conjunto (housing_complex) para o filtro multiselect.
  .get('/opcoes/conjunto', async (c) => {
    try {
      const user = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(user.id, user.role)
      assertTitularCaixaCan(perms, 'view')
      const result = await listConjuntoOptions(perms)
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Opcoes distintas de logradouro para o filtro multiselect.
  .get('/opcoes/logradouro', async (c) => {
    try {
      const user = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(user.id, user.role)
      assertTitularCaixaCan(perms, 'view')
      const result = await listLogradouroOptions(perms)
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  // Import cobre a planilha inteira (sem recorte por conjunto), entao gate cedo pela
  // FLAG via requirePermission — ANTES de ler o corpo (ate 25MB), diferente das
  // demais rotas que precisam de perms no handler.
  .post(
    '/import',
    requirePermission('titularCaixa', 'import'),
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
  .post('/reconsultar', jsonValidator(reconsultarPayloadSchema), async (c) => {
    try {
      const user = getAuthenticatedUser(c)
      const perms = await resolveUserPermissions(user.id, user.role)
      assertTitularCaixaCan(perms, 'reconsultar')
      const { ids } = c.req.valid('json')
      const result = await reconsultarTitulares(ids, perms)
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
        const user = getAuthenticatedUser(c)
        const perms = await resolveUserPermissions(user.id, user.role)
        assertTitularCaixaCan(perms, 'view')
        const { id, docId } = c.req.valid('param')
        const url = await getTitularDocumentDownloadUrl({
          titularId: id,
          docId,
          perms,
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
        const user = getAuthenticatedUser(c)
        const perms = await resolveUserPermissions(user.id, user.role)
        assertTitularCaixaCan(perms, 'view')
        const { id, docId } = c.req.valid('param')
        const url = await getTitularDocumentInlineUrl({
          titularId: id,
          docId,
          perms,
        })
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
    paramsValidator(titularDocumentoParamsSchema),
    async (c) => {
      try {
        const user = getAuthenticatedUser(c)
        const perms = await resolveUserPermissions(user.id, user.role)
        assertTitularCaixaCan(perms, 'view')
        const { id, docId } = c.req.valid('param')
        const doc = await getTitularDocumentBytes({
          titularId: id,
          docId,
          perms,
        })
        c.header('content-type', doc.contentType || 'application/pdf')
        c.header('content-disposition', 'inline')
        c.header('cache-control', 'private, max-age=300')
        return c.body(doc.bytes.slice().buffer as ArrayBuffer)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
