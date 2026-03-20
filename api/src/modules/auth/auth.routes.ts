import { asc, count, ilike, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../shared/db'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import {
  jsonValidator,
  queryValidator,
} from '../../shared/validation/validators'
import { user } from './auth.schema'
import { changeInitialPasswordPayloadSchema } from './auth.schemas'
import { changeInitialPassword } from './auth.user-management.service'

export const authRoutes = new Hono<AppBindings>()
  .get('/session', (c) => {
    const session = c.get('session')
    const currentUser = c.get('user')

    if (!session || !currentUser) {
      return c.json({ session: null, user: null }, 401)
    }

    return c.json({ session, user: currentUser }, 200)
  })
  .post(
    '/session/change-initial-password',
    jsonValidator(changeInitialPasswordPayloadSchema),
    async (c) => {
      const currentUser = c.get('user')

      if (!currentUser) {
        return c.json({ message: 'Sessao invalida.' }, 401)
      }

      try {
        await changeInitialPassword({
          newPassword: c.req.valid('json').newPassword,
          userId: currentUser.id,
        })

        return c.json({ message: 'Senha atualizada com sucesso.' }, 200)
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .get(
    '/users/options',
    queryValidator(
      z.object({
        search: z.string().trim().max(150).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        page: z.coerce.number().int().min(1).default(1),
      }),
    ),
    async (c) => {
      const currentUser = c.get('user')

      if (!currentUser) {
        return c.json({ message: 'Sessao invalida.' }, 401)
      }

      const query = c.req.valid('query')
      const offset = (query.page - 1) * query.limit
      const searchFilter = query.search
        ? or(
            ilike(user.name, `%${query.search}%`),
            ilike(user.username, `%${query.search}%`),
          )
        : undefined

      const [items, totalResult] = await Promise.all([
        db
          .select({
            id: user.id,
            name: user.name,
            role: user.role,
            username: user.username,
          })
          .from(user)
          .where(searchFilter)
          .orderBy(asc(user.name))
          .limit(query.limit)
          .offset(offset),
        db.select({ total: count() }).from(user).where(searchFilter),
      ])

      return c.json(
        {
          items,
          page: query.page,
          pageSize: query.limit,
          total: totalResult[0]?.total ?? 0,
        },
        200,
      )
    },
  )
