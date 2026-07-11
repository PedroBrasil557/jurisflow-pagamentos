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
  assertCadastrosCan,
  assertTitularCaixaCan,
  resolveUserPermissions,
} from '../permissions/permissions.service'
import { importTitularesFromXlsx } from './titulares-caixa.import.service'
import {
  bulkLinkConjuntoPayloadSchema,
  exportTitularesQuerySchema,
  listTitularesQuerySchema,
  reconsultarPayloadSchema,
  titularDocumentoParamsSchema,
  titularIdParamsSchema,
  upsertTerceiroPayloadSchema,
} from './titulares-caixa.schemas'
import {
  bulkLinkTitularConjunto,
  exportTitulares,
  getTitularDocumentDownloadUrl,
  getTitularDocumentInlineUrl,
  listConjuntoOptions,
  listEmpreendimentoOptions,
  listLogradouroOptions,
  listTitulares,
  reconsultarTitulares,
  upsertTitularTerceiro,
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
  // Vincula/desvincula titulares a um conjunto (housing_complex), em massa — alvo
  // por `ids` OU pelo `filter` inteiro (todos os que casam o filtro atual). Curadoria
  // de dado que muda quem enxerga o titular -> exige a permissao de gerir conjuntos
  // (cadastros.conjuntos), nao so titularCaixa.view.
  .post(
    '/vincular-conjunto',
    jsonValidator(bulkLinkConjuntoPayloadSchema),
    async (c) => {
      try {
        const user = getAuthenticatedUser(c)
        const perms = await resolveUserPermissions(user.id, user.role)
        assertCadastrosCan(perms, 'conjuntos')
        const { housingComplexId, ids, filter } = c.req.valid('json')
        const result = await bulkLinkTitularConjunto({
          housingComplexId,
          ids,
          filter,
          perms,
        })
        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  // Upsert do terceiro (exatamente um por titular). Sem delete: telefones min(1)
  // torna terceiro vazio impossivel; correcao = editar. Gate: titularCaixa.view
  // (decisao de produto: quem ve o menu pode criar/editar o terceiro).
  .put(
    '/:id/terceiro',
    paramsValidator(titularIdParamsSchema),
    jsonValidator(upsertTerceiroPayloadSchema),
    async (c) => {
      try {
        const user = getAuthenticatedUser(c)
        const perms = await resolveUserPermissions(user.id, user.role)
        assertTitularCaixaCan(perms, 'view')
        const { id } = c.req.valid('param')
        const terceiro = await upsertTitularTerceiro({
          titularId: id,
          ...c.req.valid('json'),
          perms,
        })
        return c.json({ terceiro }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
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
  // URL pre-assinada INLINE para o viewer de PDF (react-pdf/pdfjs). O browser
  // busca os bytes DIRETO do S3/MinIO (CORS do bucket ja permite GET do web) —
  // servir bytes pela API estoura o teto de 10MB de resposta do API Gateway em
  // prod (mesmo motivo do upload por presigned PUT).
  .get(
    '/:id/documentos/:docId/preview-url',
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
        return c.json({ url }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
