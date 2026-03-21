import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import * as schema from './schema'

const globalForDatabase = globalThis as typeof globalThis & {
  __apiPool?: Pool
}

const pool =
  globalForDatabase.__apiPool ??
  new Pool({
    connectionString: env.databaseUrl,
    ssl: process.env.ENVIRONMENT ? { rejectUnauthorized: false } : false,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDatabase.__apiPool = pool
}

export const db = drizzle(pool, { schema })
