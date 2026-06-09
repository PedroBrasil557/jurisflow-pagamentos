import { asc, count, eq, ilike, inArray } from 'drizzle-orm'
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
  district: string | null
  city: string | null
  state: string | null
  zipcode: string | null
  vara: string | null
  causeValue: string | null
}

type UpdateHousingComplexPayload = {
  name: string
  district: string | null
  city: string | null
  state: string | null
  zipcode: string | null
  vara: string | null
  causeValue: string | null
}

function selectHousingComplexFields() {
  return {
    id: housingComplex.id,
    name: housingComplex.name,
    district: housingComplex.district,
    city: housingComplex.city,
    state: housingComplex.state,
    zipcode: housingComplex.zipcode,
    vara: housingComplex.vara,
    causeValue: housingComplex.causeValue,
    createdAt: housingComplex.createdAt,
  }
}

function selectHousingComplexOptionFields() {
  return {
    id: housingComplex.id,
    name: housingComplex.name,
    district: housingComplex.district,
    city: housingComplex.city,
    state: housingComplex.state,
    zipcode: housingComplex.zipcode,
  }
}

export async function listHousingComplexes(query: ListHousingComplexesQuery) {
  const offset = (query.page - 1) * query.limit
  const searchFilter = query.search
    ? ilike(housingComplex.name, `%${query.search}%`)
    : undefined

  const [items, totalResult] = await Promise.all([
    db
      .select(selectHousingComplexFields())
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
  ids?: string[]
  limit: number
  page: number
}

export async function listHousingComplexOptions(
  query: ListHousingComplexOptionsQuery,
) {
  const offset = (query.page - 1) * query.limit
  // Quando `ids` e informado, resolvemos os conjuntos selecionados pelo filtro
  // (para exibir nomes nos chips), ignorando a busca textual.
  const searchFilter = query.ids?.length
    ? inArray(housingComplex.id, query.ids)
    : query.search
      ? ilike(housingComplex.name, `%${query.search}%`)
      : undefined

  const [items, totalResult] = await Promise.all([
    db
      .select(selectHousingComplexOptionFields())
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
    .values({
      id,
      name: payload.name,
      district: payload.district,
      city: payload.city,
      state: payload.state,
      zipcode: payload.zipcode,
      vara: payload.vara,
      causeValue: payload.causeValue,
    })
    .returning(selectHousingComplexFields())

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
    .set({
      name: payload.name,
      district: payload.district,
      city: payload.city,
      state: payload.state,
      zipcode: payload.zipcode,
      vara: payload.vara,
      causeValue: payload.causeValue,
    })
    .where(eq(housingComplex.id, id))
    .returning(selectHousingComplexFields())

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
