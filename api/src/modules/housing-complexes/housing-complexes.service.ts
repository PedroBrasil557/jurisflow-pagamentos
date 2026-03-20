import { asc, count, eq, ilike } from 'drizzle-orm'
import { db } from '../../shared/db'
import { HousingComplexServiceError } from './housing-complexes.errors'
import { housingComplex } from './housing-complexes.schema'

type ListHousingComplexesQuery = {
  limit: number
  page: number
  search?: string
}

type CreateHousingComplexPayload = {
  name: string
}

type UpdateHousingComplexPayload = {
  name: string
}

export async function listHousingComplexes(query: ListHousingComplexesQuery) {
  const offset = (query.page - 1) * query.limit
  const searchFilter = query.search
    ? ilike(housingComplex.name, `%${query.search}%`)
    : undefined

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: housingComplex.id,
        name: housingComplex.name,
        createdAt: housingComplex.createdAt,
      })
      .from(housingComplex)
      .where(searchFilter)
      .orderBy(asc(housingComplex.name))
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(housingComplex).where(searchFilter),
  ])

  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total: totalResult[0]?.total ?? 0,
  }
}

type ListHousingComplexOptionsQuery = {
  search?: string
  limit: number
  page: number
}

export async function listHousingComplexOptions(
  query: ListHousingComplexOptionsQuery,
) {
  const offset = (query.page - 1) * query.limit
  const searchFilter = query.search
    ? ilike(housingComplex.name, `%${query.search}%`)
    : undefined

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: housingComplex.id,
        name: housingComplex.name,
      })
      .from(housingComplex)
      .where(searchFilter)
      .orderBy(asc(housingComplex.name))
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(housingComplex).where(searchFilter),
  ])

  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total: totalResult[0]?.total ?? 0,
  }
}

export async function createHousingComplex(
  payload: CreateHousingComplexPayload,
) {
  const existing = await db
    .select({ id: housingComplex.id })
    .from(housingComplex)
    .where(eq(housingComplex.name, payload.name))
    .limit(1)

  if (existing.length > 0) {
    throw new HousingComplexServiceError(
      409,
      'Ja existe um conjunto com esse nome.',
    )
  }

  const id = crypto.randomUUID()

  const [created] = await db
    .insert(housingComplex)
    .values({ id, name: payload.name })
    .returning({
      id: housingComplex.id,
      name: housingComplex.name,
      createdAt: housingComplex.createdAt,
    })

  return created
}

export async function updateHousingComplex(
  id: string,
  payload: UpdateHousingComplexPayload,
) {
  const existing = await db
    .select({ id: housingComplex.id })
    .from(housingComplex)
    .where(eq(housingComplex.id, id))
    .limit(1)

  if (existing.length === 0) {
    throw new HousingComplexServiceError(404, 'Conjunto nao encontrado.')
  }

  const duplicate = await db
    .select({ id: housingComplex.id })
    .from(housingComplex)
    .where(eq(housingComplex.name, payload.name))
    .limit(1)

  if (duplicate.length > 0 && duplicate[0].id !== id) {
    throw new HousingComplexServiceError(
      409,
      'Ja existe um conjunto com esse nome.',
    )
  }

  const [updated] = await db
    .update(housingComplex)
    .set({ name: payload.name })
    .where(eq(housingComplex.id, id))
    .returning({
      id: housingComplex.id,
      name: housingComplex.name,
      createdAt: housingComplex.createdAt,
    })

  return updated
}

export async function deleteHousingComplex(id: string) {
  const existing = await db
    .select({ id: housingComplex.id })
    .from(housingComplex)
    .where(eq(housingComplex.id, id))
    .limit(1)

  if (existing.length === 0) {
    throw new HousingComplexServiceError(404, 'Conjunto nao encontrado.')
  }

  await db.delete(housingComplex).where(eq(housingComplex.id, id))
}
