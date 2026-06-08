import { and, count, desc, eq, gt, ilike, lte, or } from 'drizzle-orm'
import { db } from '../../shared/db'
import { session, user } from '../auth/auth.schema'
import { loginEvent } from './auth-audit.schema'
import { resolveGeo } from './geoip.service'

type LoginStatus = 'success' | 'failure'

type RecordLoginEventInput = {
  userId: string | null
  identifier: string
  userName: string | null
  status: LoginStatus
  failureReason: string | null
  ipAddress: string | null
  userAgent: string | null
}

// Insere o evento de login imediatamente (sem geo, para nao atrasar a resposta).
// Retorna o id para enriquecimento posterior.
export async function recordLoginEvent(input: RecordLoginEventInput) {
  const id = crypto.randomUUID()

  await db.insert(loginEvent).values({
    id,
    userId: input.userId,
    identifier: input.identifier,
    userName: input.userName,
    status: input.status,
    failureReason: input.failureReason,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  })

  return id
}

// Resolve a localidade do IP e atualiza a linha. Chamado de forma nao bloqueante.
export async function enrichEventGeo(
  eventId: string,
  ip: string | null | undefined,
) {
  const geo = await resolveGeo(ip)

  if (!geo.city && !geo.region && !geo.country) {
    return
  }

  await db
    .update(loginEvent)
    .set({ city: geo.city, region: geo.region, country: geo.country })
    .where(eq(loginEvent.id, eventId))
}

type ListLoginEventsInput = {
  page: number
  limit: number
  search?: string
  status?: LoginStatus
  userId?: string
  from?: Date
  to?: Date
}

export async function listLoginEvents(input: ListLoginEventsInput) {
  const filters = []

  if (input.search) {
    const term = `%${input.search}%`
    filters.push(
      or(ilike(loginEvent.identifier, term), ilike(loginEvent.userName, term)),
    )
  }

  if (input.status) {
    filters.push(eq(loginEvent.status, input.status))
  }

  if (input.userId) {
    filters.push(eq(loginEvent.userId, input.userId))
  }

  if (input.from) {
    filters.push(gt(loginEvent.createdAt, input.from))
  }

  if (input.to) {
    const endOfDay = new Date(input.to)
    endOfDay.setHours(23, 59, 59, 999)
    filters.push(lte(loginEvent.createdAt, endOfDay))
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined
  const offset = (input.page - 1) * input.limit

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(loginEvent)
      .where(whereClause)
      .orderBy(desc(loginEvent.createdAt))
      .limit(input.limit)
      .offset(offset),
    db
      .select({ value: count(loginEvent.id) })
      .from(loginEvent)
      .where(whereClause),
  ])

  return {
    items,
    page: input.page,
    pageSize: input.limit,
    total: Number(totalResult[0]?.value ?? 0),
  }
}

type ListActiveSessionsInput = {
  page: number
  limit: number
  search?: string
}

export async function listActiveSessions(input: ListActiveSessionsInput) {
  const filters = [gt(session.expiresAt, new Date())]

  if (input.search) {
    const term = `%${input.search}%`
    const searchFilter = or(
      ilike(user.name, term),
      ilike(user.email, term),
      ilike(user.username, term),
    )
    if (searchFilter) {
      filters.push(searchFilter)
    }
  }

  const whereClause = and(...filters)
  const offset = (input.page - 1) * input.limit

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: session.id,
        userId: session.userId,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(whereClause)
      .orderBy(desc(session.createdAt))
      .limit(input.limit)
      .offset(offset),
    db
      .select({ value: count(session.id) })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(whereClause),
  ])

  // Enriquece a localidade a partir do cache de IP (sem custo para localhost).
  const items = await Promise.all(
    rows.map(async (row) => {
      const geo = await resolveGeo(row.ipAddress)
      return { ...row, ...geo }
    }),
  )

  return {
    items,
    page: input.page,
    pageSize: input.limit,
    total: Number(totalResult[0]?.value ?? 0),
  }
}

// Revoga (encerra) uma sessao ativa. A tabela session e a fonte da verdade do
// better-auth, lida a cada request, entao o delete invalida o acesso imediatamente.
export async function revokeSession(sessionId: string) {
  const [deleted] = await db
    .delete(session)
    .where(eq(session.id, sessionId))
    .returning({ id: session.id })

  return { revoked: !!deleted }
}
