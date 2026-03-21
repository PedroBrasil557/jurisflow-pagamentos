import { randomInt } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { normalizeCpf } from '../../shared/utils/cpf'
import { isUserRole, type UserRole } from './auth.roles'
import { user as userTable } from './auth.schema'
import { auth } from './auth.service'

export class AuthUserManagementError extends ServiceError {}

type ListPlatformUsersInput = {
  limit: number
  page: number
  search?: string
}

type CreatePlatformUserInput = {
  cpf: string
  createdByUserId?: string
  email?: string
  name: string
  password: string
  role: UserRole
}

const temporaryPasswordAlphabet =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-_'

function buildPlaceholderEmail(cpf: string) {
  return `${cpf}@internal.local`
}

function buildSearchWhere(search?: string) {
  const trimmedSearch = search?.trim()

  if (!trimmedSearch) {
    return undefined
  }

  const normalizedTextSearch = trimmedSearch.replace(/\s+/g, ' ')
  const normalizedCpf = normalizeCpf(trimmedSearch)
  const isCpfLikeSearch =
    normalizedCpf.length > 0 && /^[\d.\-\s]+$/.test(trimmedSearch)

  if (isCpfLikeSearch) {
    return sql`${userTable.username} like ${`%${normalizedCpf}%`}`
  }

  return or(
    ilike(userTable.name, `%${normalizedTextSearch}%`),
    ilike(userTable.email, `%${normalizedTextSearch}%`),
  )
}

function toUserRole(value: string) {
  if (!isUserRole(value)) {
    throw new AuthUserManagementError(400, 'Perfil invalido.')
  }

  return value
}

export function generateTemporaryPassword(length = 14) {
  return Array.from({ length }, () => {
    const index = randomInt(0, temporaryPasswordAlphabet.length)
    return temporaryPasswordAlphabet[index]
  }).join('')
}

export async function createPlatformUser(input: CreatePlatformUserInput) {
  const authContext = await auth.$context
  const normalizedCpf = normalizeCpf(input.cpf)
  const normalizedName = input.name.trim()
  const normalizedEmail =
    input.email?.trim().toLowerCase() || buildPlaceholderEmail(normalizedCpf)
  const role = toUserRole(input.role)

  const [cpfCollision] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, normalizedCpf))
    .limit(1)

  if (cpfCollision) {
    throw new AuthUserManagementError(409, 'Ja existe um usuario com este CPF.')
  }

  let createdUserId: string | null = null

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: normalizedEmail,
        name: normalizedName,
        password: input.password,
        username: normalizedCpf,
      },
    })

    createdUserId = result.user.id

    await authContext.internalAdapter.updateUser(result.user.id, {
      isActive: true,
      mustChangePassword: true,
      role,
    })

    if (input.createdByUserId) {
      await db
        .update(userTable)
        .set({
          createdByUserId: input.createdByUserId,
          updatedAt: new Date(),
        })
        .where(eq(userTable.id, result.user.id))
    }

    const [createdUser] = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        cpf: userTable.username,
        role: userTable.role,
        isActive: userTable.isActive,
        mustChangePassword: userTable.mustChangePassword,
        createdAt: userTable.createdAt,
        updatedAt: userTable.updatedAt,
        createdByUserId: userTable.createdByUserId,
      })
      .from(userTable)
      .where(eq(userTable.id, result.user.id))
      .limit(1)

    if (!createdUser) {
      throw new AuthUserManagementError(
        500,
        'Nao foi possivel carregar o usuario criado.',
      )
    }

    return {
      user: createdUser,
    }
  } catch (error) {
    if (error instanceof AuthUserManagementError) {
      throw error
    }

    if (createdUserId) {
      await authContext.internalAdapter
        .deleteUser(createdUserId)
        .catch(() => undefined)
    }

    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('already exists')
    ) {
      throw new AuthUserManagementError(
        409,
        'Nao foi possivel criar o usuario porque ja existe um cadastro com estes dados.',
      )
    }

    throw new AuthUserManagementError(500, 'Nao foi possivel criar o usuario.')
  }
}

export async function resetUserAccount(userId: string) {
  const authContext = await auth.$context

  const [currentUser] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      role: userTable.role,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)

  if (!currentUser) {
    throw new AuthUserManagementError(404, 'Usuario nao encontrado.')
  }

  const temporaryPassword = generateTemporaryPassword()

  const hashedPassword = await hashPassword(temporaryPassword)
  await authContext.internalAdapter.updatePassword(userId, hashedPassword)
  await authContext.internalAdapter.updateUser(userId, {
    mustChangePassword: true,
  })

  return {
    temporaryPassword,
    user: currentUser,
  }
}

export async function updatePlatformUser(
  userId: string,
  input: { email?: string; name: string; role: UserRole },
) {
  const authContext = await auth.$context
  const role = toUserRole(input.role)

  const [currentUser] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)

  if (!currentUser) {
    throw new AuthUserManagementError(404, 'Usuario nao encontrado.')
  }

  const normalizedName = input.name.trim()
  const normalizedEmail = input.email?.trim().toLowerCase() || undefined

  await authContext.internalAdapter.updateUser(userId, {
    name: normalizedName,
    role,
  })

  if (normalizedEmail) {
    await db
      .update(userTable)
      .set({ email: normalizedEmail, updatedAt: new Date() })
      .where(eq(userTable.id, userId))
  }

  const [updatedUser] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      cpf: userTable.username,
      role: userTable.role,
      isActive: userTable.isActive,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)

  return { user: updatedUser }
}

export async function listPlatformUsers(input: ListPlatformUsersInput) {
  const creator = alias(userTable, 'creator')
  const whereClause = buildSearchWhere(input.search)
  const offset = (input.page - 1) * input.limit

  const [items, totalResult] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        cpf: userTable.username,
        role: userTable.role,
        isActive: userTable.isActive,
        mustChangePassword: userTable.mustChangePassword,
        createdAt: userTable.createdAt,
        createdByUserId: userTable.createdByUserId,
        createdByName: creator.name,
      })
      .from(userTable)
      .leftJoin(creator, eq(userTable.createdByUserId, creator.id))
      .where(whereClause)
      .orderBy(desc(userTable.createdAt), userTable.name)
      .limit(input.limit)
      .offset(offset),
    db
      .select({
        value: count(userTable.id),
      })
      .from(userTable)
      .where(whereClause),
  ])

  return {
    items,
    page: input.page,
    pageSize: input.limit,
    total: Number(totalResult[0]?.value ?? 0),
  }
}

export async function changeInitialPassword(input: {
  newPassword: string
  userId: string
}) {
  const authContext = await auth.$context
  const [currentUser] = await db
    .select({
      id: userTable.id,
      mustChangePassword: userTable.mustChangePassword,
    })
    .from(userTable)
    .where(eq(userTable.id, input.userId))
    .limit(1)

  if (!currentUser) {
    throw new AuthUserManagementError(404, 'Usuario nao encontrado.')
  }

  if (!currentUser.mustChangePassword) {
    throw new AuthUserManagementError(
      400,
      'Este usuario nao possui troca obrigatoria de senha pendente.',
    )
  }

  const hashedPassword = await hashPassword(input.newPassword)
  await authContext.internalAdapter.updatePassword(input.userId, hashedPassword)
  await authContext.internalAdapter.updateUser(input.userId, {
    mustChangePassword: false,
  })
}
