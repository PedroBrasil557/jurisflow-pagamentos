import { Hono } from 'hono'
import { requireAuth, requireRole } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  createHousingComplexPayloadSchema,
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

export const housingComplexAdminRoutes = new Hono<AppBindings>()
  .use('*', requireRole('admin'))
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
