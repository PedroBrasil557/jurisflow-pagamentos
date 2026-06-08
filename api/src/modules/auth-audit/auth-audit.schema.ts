import { index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const loginStatusEnum = pgEnum('login_status', ['success', 'failure'])

// Historico imutavel de tentativas de login (sucesso e falha). Mantido mesmo
// apos a sessao expirar ou o usuario ser removido (userId nullable, sem cascade).
export const loginEvent = pgTable(
  'login_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id'),
    identifier: text('identifier').notNull(),
    userName: text('user_name'),
    status: loginStatusEnum('status').notNull(),
    failureReason: text('failure_reason'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('login_event_userId_idx').on(table.userId),
    index('login_event_createdAt_idx').on(table.createdAt),
    index('login_event_status_idx').on(table.status),
  ],
)

// Cache de geolocalizacao por IP para evitar chamadas externas repetidas.
export const ipGeoCache = pgTable('ip_geo_cache', {
  ip: text('ip').primaryKey(),
  city: text('city'),
  region: text('region'),
  country: text('country'),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
})
