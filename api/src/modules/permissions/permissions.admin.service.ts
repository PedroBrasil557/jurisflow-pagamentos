import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { titularContratoCaixa } from '../titulares-caixa/titulares-caixa.schema'
import { normalizeProfilePermissions } from './permissions.defaults'
import {
  permissionProfile,
  profileHousingComplex,
  userHousingComplex,
  userProfile,
  userTitularMunicipio,
  userTitularUf,
} from './permissions.schema'
import type {
  AssignProfilePayload,
  CreateProfilePayload,
  ListProfilesQuery,
  UpdateProfilePayload,
  UpdateUserHousingComplexesPayload,
  UpdateUserTitularMunicipiosPayload,
  UpdateUserTitularUfsPayload,
} from './permissions.schemas'

// ---------------------------------------------------------------------------
// Listagem e leitura de perfis
// ---------------------------------------------------------------------------

export async function listProfiles(query: ListProfilesQuery) {
  const filters = query.search
    ? [ilike(permissionProfile.name, `%${query.search}%`)]
    : []

  const whereClause = filters.length > 0 ? and(...filters) : undefined
  const offset = (query.page - 1) * query.limit

  const [items, [totalRow]] = await Promise.all([
    db
      .select({
        id: permissionProfile.id,
        name: permissionProfile.name,
        description: permissionProfile.description,
        isSystem: permissionProfile.isSystem,
        processScope: permissionProfile.processScope,
        createdAt: permissionProfile.createdAt,
        updatedAt: permissionProfile.updatedAt,
      })
      .from(permissionProfile)
      .where(whereClause)
      .orderBy(permissionProfile.name)
      .limit(query.limit)
      .offset(offset),
    db.select({ total: count() }).from(permissionProfile).where(whereClause),
  ])

  if (items.length === 0) {
    return { items: [], page: query.page, pageSize: query.limit, total: 0 }
  }

  const profileIds = items.map((p) => p.id)

  const [userCounts, hcRows] = await Promise.all([
    db
      .select({
        profileId: userProfile.profileId,
        userCount: count(),
      })
      .from(userProfile)
      .where(inArray(userProfile.profileId, profileIds))
      .groupBy(userProfile.profileId),
    db
      .select({
        profileId: profileHousingComplex.profileId,
        housingComplexId: profileHousingComplex.housingComplexId,
        housingComplexName: housingComplex.name,
      })
      .from(profileHousingComplex)
      .innerJoin(
        housingComplex,
        eq(profileHousingComplex.housingComplexId, housingComplex.id),
      )
      .where(inArray(profileHousingComplex.profileId, profileIds)),
  ])

  const userCountByProfile = new Map(
    userCounts.map((r) => [r.profileId, r.userCount]),
  )
  const hcByProfile = new Map<string, { id: string; name: string }[]>()
  for (const row of hcRows) {
    const list = hcByProfile.get(row.profileId) ?? []
    list.push({ id: row.housingComplexId, name: row.housingComplexName })
    hcByProfile.set(row.profileId, list)
  }

  return {
    items: items.map((p) => ({
      ...p,
      userCount: userCountByProfile.get(p.id) ?? 0,
      housingComplexes: hcByProfile.get(p.id) ?? [],
    })),
    page: query.page,
    pageSize: query.limit,
    total: totalRow?.total ?? 0,
  }
}

export async function getProfileOrThrow(profileId: string) {
  const [profile] = await db
    .select()
    .from(permissionProfile)
    .where(eq(permissionProfile.id, profileId))
    .limit(1)

  if (!profile) {
    throw new ServiceError(404, 'Perfil nao encontrado.')
  }

  const [hcRows, userRows] = await Promise.all([
    db
      .select({
        id: housingComplex.id,
        name: housingComplex.name,
      })
      .from(profileHousingComplex)
      .innerJoin(
        housingComplex,
        eq(profileHousingComplex.housingComplexId, housingComplex.id),
      )
      .where(eq(profileHousingComplex.profileId, profileId)),
    db
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        assignedAt: userProfile.assignedAt,
      })
      .from(userProfile)
      .innerJoin(user, eq(userProfile.userId, user.id))
      .where(eq(userProfile.profileId, profileId))
      .orderBy(user.name),
  ])

  return {
    ...profile,
    // Perfis gravados antes de um grupo de permissao existir nao tem a chave no
    // JSON — normaliza para o editor sempre receber a forma completa.
    permissions: normalizeProfilePermissions(profile.permissions),
    housingComplexes: hcRows,
    users: userRows,
  }
}

// ---------------------------------------------------------------------------
// CRUD de perfis
// ---------------------------------------------------------------------------

export async function createProfile(
  payload: CreateProfilePayload,
  _createdByUserId: string,
) {
  const profileId = crypto.randomUUID()

  const [created] = await db
    .insert(permissionProfile)
    .values({
      id: profileId,
      name: payload.name.trim(),
      description: payload.description?.trim() ?? null,
      isSystem: false,
      processScope: payload.processScope,
      permissions: payload.permissions,
    })
    .returning()

  if (
    payload.processScope === 'housing_complex' &&
    payload.housingComplexIds.length > 0
  ) {
    await db.insert(profileHousingComplex).values(
      payload.housingComplexIds.map((hcId) => ({
        profileId,
        housingComplexId: hcId,
      })),
    )
  }

  return created
}

export async function updateProfile(
  profileId: string,
  payload: UpdateProfilePayload,
) {
  const [existing] = await db
    .select({ id: permissionProfile.id, isSystem: permissionProfile.isSystem })
    .from(permissionProfile)
    .where(eq(permissionProfile.id, profileId))
    .limit(1)

  if (!existing) {
    throw new ServiceError(404, 'Perfil nao encontrado.')
  }

  if (existing.isSystem) {
    throw new ServiceError(
      403,
      'Perfis de sistema nao podem ser editados. Duplique o perfil para customiza-lo.',
    )
  }

  const [updated] = await db
    .update(permissionProfile)
    .set({
      name: payload.name.trim(),
      description: payload.description?.trim() ?? null,
      processScope: payload.processScope,
      permissions: payload.permissions,
    })
    .where(eq(permissionProfile.id, profileId))
    .returning()

  // Atualiza conjuntos vinculados: substitui a lista completa
  await db
    .delete(profileHousingComplex)
    .where(eq(profileHousingComplex.profileId, profileId))

  if (
    payload.processScope === 'housing_complex' &&
    payload.housingComplexIds.length > 0
  ) {
    await db.insert(profileHousingComplex).values(
      payload.housingComplexIds.map((hcId) => ({
        profileId,
        housingComplexId: hcId,
      })),
    )
  }

  return updated
}

export async function deleteProfile(profileId: string) {
  const [existing] = await db
    .select({ id: permissionProfile.id, isSystem: permissionProfile.isSystem })
    .from(permissionProfile)
    .where(eq(permissionProfile.id, profileId))
    .limit(1)

  if (!existing) {
    throw new ServiceError(404, 'Perfil nao encontrado.')
  }

  if (existing.isSystem) {
    throw new ServiceError(403, 'Perfis de sistema nao podem ser excluidos.')
  }

  const [usageCount] = await db
    .select({ total: count() })
    .from(userProfile)
    .where(eq(userProfile.profileId, profileId))

  if ((usageCount?.total ?? 0) > 0) {
    throw new ServiceError(
      409,
      `Este perfil possui ${usageCount?.total} usuario(s) vinculado(s) e nao pode ser excluido. Reatribua os usuarios antes de excluir.`,
    )
  }

  await db.delete(permissionProfile).where(eq(permissionProfile.id, profileId))
}

// ---------------------------------------------------------------------------
// Atribuição de perfil a usuário
// ---------------------------------------------------------------------------

export async function assignProfileToUser(
  userId: string,
  payload: AssignProfilePayload,
  assignedByUserId: string,
) {
  const [profile] = await db
    .select({ id: permissionProfile.id })
    .from(permissionProfile)
    .where(eq(permissionProfile.id, payload.profileId))
    .limit(1)

  if (!profile) {
    throw new ServiceError(404, 'Perfil nao encontrado.')
  }

  await db
    .insert(userProfile)
    .values({
      userId,
      profileId: payload.profileId,
      assignedAt: new Date(),
      assignedByUserId,
    })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: {
        profileId: payload.profileId,
        assignedAt: new Date(),
        assignedByUserId,
      },
    })
}

// ---------------------------------------------------------------------------
// Conjuntos individuais do usuário
// ---------------------------------------------------------------------------

export async function getUserHousingComplexes(userId: string) {
  return db
    .select({
      id: housingComplex.id,
      name: housingComplex.name,
      grantedAt: userHousingComplex.grantedAt,
    })
    .from(userHousingComplex)
    .innerJoin(
      housingComplex,
      eq(userHousingComplex.housingComplexId, housingComplex.id),
    )
    .where(eq(userHousingComplex.userId, userId))
    .orderBy(housingComplex.name)
}

export async function updateUserHousingComplexes(
  userId: string,
  payload: UpdateUserHousingComplexesPayload,
  grantedByUserId: string,
) {
  await db
    .delete(userHousingComplex)
    .where(eq(userHousingComplex.userId, userId))

  if (payload.housingComplexIds.length > 0) {
    await db.insert(userHousingComplex).values(
      payload.housingComplexIds.map((hcId) => ({
        userId,
        housingComplexId: hcId,
        grantedAt: new Date(),
        grantedByUserId,
      })),
    )
  }
}

// ---------------------------------------------------------------------------
// Grants geográficos do usuário (Titular Caixa): UF e município
// ---------------------------------------------------------------------------

export async function getUserTitularUfs(userId: string) {
  return db
    .select({ uf: userTitularUf.uf })
    .from(userTitularUf)
    .where(eq(userTitularUf.userId, userId))
    .orderBy(asc(userTitularUf.uf))
}

export async function updateUserTitularUfs(
  userId: string,
  payload: UpdateUserTitularUfsPayload,
  grantedByUserId: string,
) {
  await db.delete(userTitularUf).where(eq(userTitularUf.userId, userId))

  // Dedup defensivo (a PK já barra duplicatas, mas evita erro no insert em lote).
  const ufs = [...new Set(payload.ufs)]
  if (ufs.length > 0) {
    await db.insert(userTitularUf).values(
      ufs.map((uf) => ({
        userId,
        uf,
        grantedAt: new Date(),
        grantedByUserId,
      })),
    )
  }
}

export async function getUserTitularMunicipios(userId: string) {
  return db
    .select({
      uf: userTitularMunicipio.uf,
      municipio: userTitularMunicipio.municipio,
    })
    .from(userTitularMunicipio)
    .where(eq(userTitularMunicipio.userId, userId))
    .orderBy(asc(userTitularMunicipio.uf), asc(userTitularMunicipio.municipio))
}

export async function updateUserTitularMunicipios(
  userId: string,
  payload: UpdateUserTitularMunicipiosPayload,
  grantedByUserId: string,
) {
  await db
    .delete(userTitularMunicipio)
    .where(eq(userTitularMunicipio.userId, userId))

  // Dedup por par uf|municipio.
  const seen = new Set<string>()
  const rows = payload.municipios.filter((m) => {
    const key = `${m.uf}|${m.municipio}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (rows.length > 0) {
    await db.insert(userTitularMunicipio).values(
      rows.map((m) => ({
        userId,
        uf: m.uf,
        municipio: m.municipio,
        grantedAt: new Date(),
        grantedByUserId,
      })),
    )
  }
}

// Localidades distintas dos titulares (fonte dos seletores de UF/município ao
// conceder acesso). SEM filtro de visibilidade — quem concede (cadastros.permissoes)
// precisa ver todas as opções. Cap de segurança nas listas.
const LOCALIDADES_CAP = 5000

export async function getTitularLocalidades(): Promise<{
  ufs: string[]
  municipios: Array<{ uf: string; municipio: string }>
}> {
  const [ufRows, municipioRows] = await Promise.all([
    db
      .selectDistinct({ uf: titularContratoCaixa.uf })
      .from(titularContratoCaixa)
      .orderBy(asc(titularContratoCaixa.uf))
      .limit(LOCALIDADES_CAP),
    db
      .selectDistinct({
        uf: titularContratoCaixa.uf,
        municipio: titularContratoCaixa.municipio,
      })
      .from(titularContratoCaixa)
      .orderBy(
        asc(titularContratoCaixa.uf),
        asc(titularContratoCaixa.municipio),
      )
      .limit(LOCALIDADES_CAP),
  ])

  return {
    ufs: ufRows.map((r) => r.uf),
    municipios: municipioRows,
  }
}

// ---------------------------------------------------------------------------
// Usuários de um perfil (paginado)
// ---------------------------------------------------------------------------

export async function listProfileUsers(
  profileId: string,
  query: { page: number; limit: number; search?: string },
) {
  const [profile] = await db
    .select({ id: permissionProfile.id })
    .from(permissionProfile)
    .where(eq(permissionProfile.id, profileId))
    .limit(1)

  if (!profile) {
    throw new ServiceError(404, 'Perfil nao encontrado.')
  }

  const searchFilter = query.search
    ? or(
        ilike(user.name, `%${query.search}%`),
        ilike(user.username, `%${query.search}%`),
      )
    : undefined

  const baseFilter = searchFilter
    ? and(eq(userProfile.profileId, profileId), searchFilter)
    : eq(userProfile.profileId, profileId)

  const offset = (query.page - 1) * query.limit

  const [items, [totalRow]] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        isActive: user.isActive,
        assignedAt: userProfile.assignedAt,
      })
      .from(userProfile)
      .innerJoin(user, eq(userProfile.userId, user.id))
      .where(baseFilter)
      .orderBy(user.name)
      .limit(query.limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(userProfile)
      .innerJoin(user, eq(userProfile.userId, user.id))
      .where(baseFilter),
  ])

  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total: totalRow?.total ?? 0,
  }
}
