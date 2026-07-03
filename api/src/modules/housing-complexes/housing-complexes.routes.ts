import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
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
import { requirePermission } from '../permissions/permissions.middleware'
import { syncProcessesForHousingComplex } from '../processes/processes.checklist.service'
import {
  deleteHousingComplexFile,
  listHousingComplexFiles,
  uploadHousingComplexFile,
} from './housing-complexes.documents.service'
import {
  createHousingComplexPayloadSchema,
  housingComplexDocumentParamsSchema,
  housingComplexFileParamsSchema,
  housingComplexIdParamsSchema,
  housingComplexOptionsQuerySchema,
  listHousingComplexesQuerySchema,
  updateHousingComplexPayloadSchema,
} from './housing-complexes.schemas'
import {
  createHousingComplex,
  deleteHousingComplex,
  listHousingComplexes,
  listHousingComplexOptions,
  updateHousingComplex,
} from './housing-complexes.service'

const HOUSING_COMPLEX_FILE_MAX_BYTES = 25 * 1024 * 1024
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

const uploadDocumentBodyLimit = bodyLimit({
  maxSize: HOUSING_COMPLEX_FILE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: (c) =>
    c.json({ message: 'O arquivo enviado excede o tamanho permitido.' }, 413),
})

export const housingComplexAdminRoutes = new Hono<AppBindings>()
  // Flag cadastros.conjuntos do perfil (master e admin com a flag passam).
  .use('*', requirePermission('cadastros', 'conjuntos'))
  .get('/', queryValidator(listHousingComplexesQuerySchema), async (c) => {
    try {
      const result = await listHousingComplexes(c.req.valid('query'))

      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/', jsonValidator(createHousingComplexPayloadSchema), async (c) => {
    try {
      const result = await createHousingComplex(c.req.valid('json'))

      return c.json(
        { message: 'Conjunto criado com sucesso.', housingComplex: result },
        201,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .patch(
    '/:housingComplexId',
    paramsValidator(housingComplexIdParamsSchema),
    jsonValidator(updateHousingComplexPayloadSchema),
    async (c) => {
      try {
        const result = await updateHousingComplex(
          c.req.valid('param').housingComplexId,
          c.req.valid('json'),
        )

        return c.json(
          {
            message: 'Conjunto atualizado com sucesso.',
            housingComplex: result,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete(
    '/:housingComplexId',
    paramsValidator(housingComplexIdParamsSchema),
    async (c) => {
      try {
        await deleteHousingComplex(c.req.valid('param').housingComplexId)

        return c.json({ message: 'Conjunto excluido com sucesso.' }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/:housingComplexId/documents',
    paramsValidator(housingComplexIdParamsSchema),
    async (c) => {
      try {
        const result = await listHousingComplexFiles(
          c.req.valid('param').housingComplexId,
        )

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/:housingComplexId/documents/:documentTypeKey',
    uploadDocumentBodyLimit,
    paramsValidator(housingComplexDocumentParamsSchema),
    async (c) => {
      try {
        const { housingComplexId, documentTypeKey } = c.req.valid('param')
        const formData = await c.req.raw.formData()
        const file = formData.get('file')

        if (!(file instanceof File)) {
          return c.json({ message: 'Envie um arquivo.' }, 400)
        }

        const actor = getAuthenticatedUser(c)
        const result = await uploadHousingComplexFile({
          housingComplexId,
          documentTypeKey,
          file,
          actor,
        })

        // Reflete a mudanca na completude/status dos processos do conjunto.
        await syncProcessesForHousingComplex({ housingComplexId, actor })

        return c.json(
          { message: 'Documento anexado ao conjunto.', file: result },
          201,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete(
    '/:housingComplexId/documents/:fileId',
    paramsValidator(housingComplexFileParamsSchema),
    async (c) => {
      try {
        const { housingComplexId, fileId } = c.req.valid('param')
        await deleteHousingComplexFile({ housingComplexId, fileId })

        const actor = getAuthenticatedUser(c)
        await syncProcessesForHousingComplex({ housingComplexId, actor })

        return c.json({ message: 'Documento removido do conjunto.' }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )

export const housingComplexOptionsRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get('/', queryValidator(housingComplexOptionsQuerySchema), async (c) => {
    try {
      const result = await listHousingComplexOptions(c.req.valid('query'))

      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
