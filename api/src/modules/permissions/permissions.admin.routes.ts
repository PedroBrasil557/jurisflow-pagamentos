import { Hono } from 'hono'
import { z } from 'zod'
import { getAuthenticatedUser } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  paramsValidator,
  queryValidator,
} from '../../shared/validation/validators'
import {
  assignProfileToUser,
  createProfile,
  deleteProfile,
  getProfileOrThrow,
  getUserHousingComplexes,
  listProfiles,
  listProfileUsers,
  updateProfile,
  updateUserHousingComplexes,
} from './permissions.admin.service'
import { requirePermission } from './permissions.middleware'
import {
  assignProfilePayloadSchema,
  createProfilePayloadSchema,
  listProfilesQuerySchema,
  profileIdParamsSchema,
  updateProfilePayloadSchema,
  updateUserHousingComplexesPayloadSchema,
} from './permissions.schemas'

const userIdParamsSchema = z.object({
  userId: z.string().trim().min(1, { message: 'Informe o usuário.' }),
})

const profileUsersQuerySchema = z.object({
  search: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const permissionProfileAdminRoutes = new Hono<AppBindings>()
  // Flag cadastros.permissoes do perfil (master e admin com a flag passam).
  .use('*', requirePermission('cadastros', 'permissoes'))

  // --- Perfis ---

  .get('/', queryValidator(listProfilesQuerySchema), async (c) => {
    try {
      const result = await listProfiles(c.req.valid('query'))
      return c.json(result, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .post('/', jsonValidator(createProfilePayloadSchema), async (c) => {
    try {
      const currentUser = getAuthenticatedUser(c)
      const result = await createProfile(c.req.valid('json'), currentUser.id)
      return c.json(
        { message: 'Perfil criado com sucesso.', profile: result },
        201,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/:profileId', paramsValidator(profileIdParamsSchema), async (c) => {
    try {
      const result = await getProfileOrThrow(c.req.valid('param').profileId)
      return c.json({ profile: result }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .patch(
    '/:profileId',
    paramsValidator(profileIdParamsSchema),
    jsonValidator(updateProfilePayloadSchema),
    async (c) => {
      try {
        const result = await updateProfile(
          c.req.valid('param').profileId,
          c.req.valid('json'),
        )
        return c.json(
          { message: 'Perfil atualizado com sucesso.', profile: result },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete('/:profileId', paramsValidator(profileIdParamsSchema), async (c) => {
    try {
      await deleteProfile(c.req.valid('param').profileId)
      return c.json({ message: 'Perfil excluido com sucesso.' }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get(
    '/:profileId/users',
    paramsValidator(profileIdParamsSchema),
    queryValidator(profileUsersQuerySchema),
    async (c) => {
      try {
        const result = await listProfileUsers(
          c.req.valid('param').profileId,
          c.req.valid('query'),
        )
        return c.json(result, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )

export const permissionUserAdminRoutes = new Hono<AppBindings>()
  // Flag cadastros.permissoes do perfil (master e admin com a flag passam).
  .use('*', requirePermission('cadastros', 'permissoes'))

  // --- Perfil do usuário ---

  .put(
    '/:userId/profile',
    paramsValidator(userIdParamsSchema),
    jsonValidator(assignProfilePayloadSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        await assignProfileToUser(
          c.req.valid('param').userId,
          c.req.valid('json'),
          currentUser.id,
        )
        return c.json({ message: 'Perfil atribuido com sucesso.' }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )

  // --- Conjuntos individuais do usuário ---

  .get(
    '/:userId/housing-complexes',
    paramsValidator(userIdParamsSchema),
    async (c) => {
      try {
        const items = await getUserHousingComplexes(c.req.valid('param').userId)
        return c.json({ items }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .put(
    '/:userId/housing-complexes',
    paramsValidator(userIdParamsSchema),
    jsonValidator(updateUserHousingComplexesPayloadSchema),
    async (c) => {
      try {
        const currentUser = getAuthenticatedUser(c)
        await updateUserHousingComplexes(
          c.req.valid('param').userId,
          c.req.valid('json'),
          currentUser.id,
        )
        return c.json({ message: 'Conjuntos atualizados com sucesso.' }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
