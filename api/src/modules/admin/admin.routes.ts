import { Hono } from 'hono'
import {
  getAuthenticatedUser,
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
  createPlatformUser,
  generateTemporaryPassword,
  listPlatformUsers,
  resetUserAccount,
  updatePlatformUser,
} from '../auth/auth.user-management.service'
import {
  createAdminUserPayloadSchema,
  listAdminUsersQuerySchema,
  updateAdminUserPayloadSchema,
  userIdParamsSchema,
} from './admin.schemas'

export const adminRoutes = new Hono<AppBindings>()
  .use('*', requireRole('admin'))
  .get('/users', queryValidator(listAdminUsersQuerySchema), async (c) => {
    try {
      const result = await listPlatformUsers(c.req.valid('query'))

      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/users', jsonValidator(createAdminUserPayloadSchema), async (c) => {
    try {
      const currentUser = getAuthenticatedUser(c)
      const payload = c.req.valid('json')
      const temporaryPassword = generateTemporaryPassword()

      const result = await createPlatformUser({
        cpf: payload.cpf,
        createdByUserId: currentUser.id,
        email: payload.email,
        name: payload.name,
        password: temporaryPassword,
        role: payload.role,
      })

      return c.json(
        {
          message: 'Usuario criado com sucesso.',
          temporaryPassword,
          user: result.user,
        },
        201,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .patch(
    '/users/:userId',
    paramsValidator(userIdParamsSchema),
    jsonValidator(updateAdminUserPayloadSchema),
    async (c) => {
      try {
        const result = await updatePlatformUser(
          c.req.valid('param').userId,
          c.req.valid('json'),
        )

        return c.json(
          { message: 'Usuario atualizado com sucesso.', user: result.user },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/users/:userId/reset',
    paramsValidator(userIdParamsSchema),
    async (c) => {
      try {
        const result = await resetUserAccount(c.req.valid('param').userId)

        return c.json(
          {
            message: 'Conta resetada com sucesso.',
            temporaryPassword: result.temporaryPassword,
            user: result.user,
          },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
