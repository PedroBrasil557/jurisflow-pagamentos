import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../shared/db'

const healthQuerySchema = z.object({
  source: z.string().trim().min(1).max(64).optional().default('unknown'),
})

const echoBodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, { message: 'Informe uma mensagem.' })
    .max(240, { message: 'Mensagem muito longa.' }),
})

export const systemRoutes = new Hono()
  .get('/health', zValidator('query', healthQuerySchema), (c) => {
    const query = c.req.valid('query')

    return c.json(
      {
        ok: true,
        service: 'api',
        source: query.source,
        timestamp: new Date().toISOString(),
      },
      200,
    )
  })
  .get('/health/db', async (c) => {
    try {
      await db.execute(sql`select 1`)

      return c.json(
        {
          ok: true,
          service: 'database',
          timestamp: new Date().toISOString(),
        },
        200,
      )
    } catch (error) {
      console.error('database health check failed', {
        error: error instanceof Error ? error.message : String(error),
      })

      return c.json(
        {
          ok: false,
          service: 'database',
          timestamp: new Date().toISOString(),
        },
        503,
      )
    }
  })
  .post('/echo', zValidator('json', echoBodySchema), async (c) => {
    const body = c.req.valid('json')

    return c.json(
      {
        ok: true,
        message: body.message,
      },
      200,
    )
  })
