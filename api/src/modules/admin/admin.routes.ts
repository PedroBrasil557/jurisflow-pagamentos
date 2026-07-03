import { Hono } from 'hono'
import { ServiceError } from '../../shared/errors/service-error'
import { getAuthenticatedUser } from '../../shared/middleware/auth-guard'
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
  getPlatformUserRole,
  listPlatformUsers,
  resetUserAccount,
  updatePlatformUser,
} from '../auth/auth.user-management.service'
import { requirePermission } from '../permissions/permissions.middleware'
import {
  createAdminUserPayloadSchema,
  listAdminUsersQuerySchema,
  updateAdminUserPayloadSchema,
  userIdParamsSchema,
} from './admin.schemas'

// Gestao de usuarios liberada pela flag cadastros.usuarios do perfil (nao por
// role fixa) — guard POR ROTA: um use('*') aqui interceptaria tambem os
// sub-routers vizinhos montados sob /api/admin (security, profiles, ...).
//
// Anti-escalada: tocar em ADMIN (criar/promover isAdmin, editar ou resetar um
// usuario admin) continua exigindo role admin do ator — sem isso, a flag
// cadastros.usuarios viraria escalada de privilegio (ex.: reset devolve senha
// temporaria = tomada da conta de um admin).
async function assertActorCanTouchAdmin(input: {
  actorRole: string
  wantsAdmin?: boolean
  targetUserId?: string
}) {
  if (input.actorRole === 'admin') return
  if (input.wantsAdmin) {
    throw new ServiceError(
      403,
      'Apenas administradores podem conceder acesso de administrador.',
    )
  }
  if (input.targetUserId) {
    const targetRole = await getPlatformUserRole(input.targetUserId)
    if (targetRole === 'admin') {
      throw new ServiceError(
        403,
        'Apenas administradores podem gerenciar usuarios administradores.',
      )
    }
  }
}

export const adminRoutes = new Hono<AppBindings>()
  .get(
    '/users',
    requirePermission('cadastros', 'usuarios'),
    queryValidator(listAdminUsersQuerySchema),
    async (c) => {
      try {
        const result = await listPlatformUsers(c.req.valid('query'))

        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .post(
    '/users',
    requirePermission('cadastros', 'usuarios'),
    jsonValidator(createAdminUserPayloadSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        const payload = c.req.valid('json')
        await assertActorCanTouchAdmin({
          actorRole: currentUser.role,
          wantsAdmin: payload.isAdmin,
        })
        const temporaryPassword = generateTemporaryPassword()

        const result = await createPlatformUser({
          cpf: payload.cpf,
          createdByUserId: currentUser.id,
          email: payload.email,
          isAdmin: payload.isAdmin,
          name: payload.name,
          password: temporaryPassword,
          profileId: payload.profileId,
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
    },
  )
  .patch(
    '/users/:userId',
    requirePermission('cadastros', 'usuarios'),
    paramsValidator(userIdParamsSchema),
    jsonValidator(updateAdminUserPayloadSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        const payload = c.req.valid('json')
        const { userId } = c.req.valid('param')
        await assertActorCanTouchAdmin({
          actorRole: currentUser.role,
          wantsAdmin: payload.isAdmin,
          targetUserId: userId,
        })
        const result = await updatePlatformUser(userId, payload, currentUser.id)

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
    requirePermission('cadastros', 'usuarios'),
    paramsValidator(userIdParamsSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        const { userId } = c.req.valid('param')
        await assertActorCanTouchAdmin({
          actorRole: currentUser.role,
          targetUserId: userId,
        })
        const result = await resetUserAccount(userId)

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
