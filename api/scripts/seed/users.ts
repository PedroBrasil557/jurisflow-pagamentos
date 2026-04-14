import { verifyPassword } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { account, user as userTable } from '../../src/modules/auth/auth.schema'
import { auth } from '../../src/modules/auth/auth.service'
import { createPlatformUser } from '../../src/modules/auth/auth.user-management.service'
import { SYSTEM_PROFILE_IDS } from '../../src/modules/permissions/permissions.defaults'
import {
  userHousingComplex,
  userProfile,
} from '../../src/modules/permissions/permissions.schema'
import { db } from '../../src/shared/db'
import { isValidCpf } from '../../src/shared/utils/cpf'

export const TEST_USER_PASSWORD = 'jurisflow123'

export type SeedUserDefinition = {
  cpf: string
  name: string
  email: string
  kind: 'admin' | 'profile'
  profileId?: string
  extraHousingComplexIds?: string[]
}

export const seedUsers: SeedUserDefinition[] = [
  {
    cpf: '12345678909',
    name: 'Administrador',
    email: 'admin@jurisflow.test',
    kind: 'admin',
  },
  {
    cpf: '11144477735',
    name: 'Carlos Advogado',
    email: 'carlos.advogado@jurisflow.test',
    kind: 'profile',
    profileId: SYSTEM_PROFILE_IDS.attorney,
  },
  {
    cpf: '52998224725',
    name: 'Beatriz Advogada',
    email: 'beatriz.advogada@jurisflow.test',
    kind: 'profile',
    profileId: SYSTEM_PROFILE_IDS.attorney,
  },
  {
    cpf: '71428793860',
    name: 'Mariana Usuaria',
    email: 'mariana.usuaria@jurisflow.test',
    kind: 'profile',
    profileId: SYSTEM_PROFILE_IDS.default_user,
  },
  {
    cpf: '39053344705',
    name: 'Paula Supervisora',
    email: 'paula.supervisora@jurisflow.test',
    kind: 'profile',
    profileId: SYSTEM_PROFILE_IDS.default_user,
    extraHousingComplexIds: ['hc_morada_do_sol'],
  },
  {
    cpf: '84521530664',
    name: 'Rafael Operador',
    email: 'rafael.operador@jurisflow.test',
    kind: 'profile',
    profileId: SYSTEM_PROFILE_IDS.default_user,
  },
  {
    cpf: '23154285997',
    name: 'Joao Agente',
    email: 'joao.agente@jurisflow.test',
    kind: 'profile',
    profileId: 'profile_agente_documentacao',
  },
  {
    cpf: '96703451206',
    name: 'Ana Agente',
    email: 'ana.agente@jurisflow.test',
    kind: 'profile',
    profileId: 'profile_agente_documentacao',
  },
  {
    cpf: '43891147600',
    name: 'Lucas Lote',
    email: 'lucas.lote@jurisflow.test',
    kind: 'profile',
    profileId: 'profile_supervisor_lote',
  },
  {
    cpf: '65781920340',
    name: 'Teresa Auditora',
    email: 'teresa.auditora@jurisflow.test',
    kind: 'profile',
    profileId: 'profile_visualizador_total',
  },
]

export type SeededUser = {
  id: string
  cpf: string
  name: string
  email: string
  kind: 'admin' | 'profile'
  profileId: string | null
  extraHousingComplexIds: string[]
}

async function findUserByCpf(cpf: string) {
  const normalized = cpf.replace(/\D/g, '')
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, normalized))
    .limit(1)
  return row ?? null
}

function assertAllCpfsAreValid() {
  const invalid = seedUsers.filter((entry) => !isValidCpf(entry.cpf))
  if (invalid.length > 0) {
    const details = invalid
      .map((entry) => `${entry.name} (${entry.cpf})`)
      .join(', ')
    throw new Error(`CPFs de seed invalidos: ${details}.`)
  }
}

const MAX_CREATE_ATTEMPTS = 8

const VERIFY_ATTEMPTS_PER_CHECK = 20
const VERIFY_MIN_SUCCESS_RATIO = 0.8

async function getUserCredentialHash(userId: string) {
  const [row] = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, 'credential')),
    )
    .limit(1)
  return row?.password ?? null
}

async function isHashUsable(hash: string, password: string) {
  let successes = 0
  for (let i = 0; i < VERIFY_ATTEMPTS_PER_CHECK; i += 1) {
    try {
      if (await verifyPassword({ hash, password })) {
        successes += 1
      }
    } catch {
      // Segue para a proxima tentativa
    }
  }
  return (
    successes / VERIFY_ATTEMPTS_PER_CHECK >= VERIFY_MIN_SUCCESS_RATIO
  )
}

async function createUserWithVerifiedHash(
  entry: SeedUserDefinition,
  password: string,
): Promise<string> {
  const authContext = await auth.$context
  const isAdmin = entry.kind === 'admin'

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    const result = await createPlatformUser({
      cpf: entry.cpf,
      name: entry.name,
      email: entry.email,
      password,
      isAdmin,
      profileId: isAdmin ? undefined : entry.profileId,
    })
    const userId = result.user.id

    const hash = await getUserCredentialHash(userId)
    if (hash && (await isHashUsable(hash, password))) {
      if (attempt > 1) {
        console.log(
          `  recriado ${entry.name} apos ${attempt - 1} tentativa(s) com hash invalido`,
        )
      }
      return userId
    }

    await authContext.internalAdapter
      .deleteUser(userId)
      .catch(() => undefined)
  }

  throw new Error(
    `Nao foi possivel criar ${entry.name} (${entry.cpf}) com hash verificavel apos ${MAX_CREATE_ATTEMPTS} tentativas.`,
  )
}

export async function seedPlatformUsers(): Promise<SeededUser[]> {
  assertAllCpfsAreValid()
  const seeded: SeededUser[] = []

  const authContext = await auth.$context

  for (const entry of seedUsers) {
    const existing = await findUserByCpf(entry.cpf)
    let userId: string

    if (existing) {
      const hash = await getUserCredentialHash(existing.id)
      if (hash && (await isHashUsable(hash, TEST_USER_PASSWORD))) {
        userId = existing.id
      } else {
        console.log(
          `  ${entry.name} ja existia com hash inutilizavel — recriando`,
        )
        await authContext.internalAdapter
          .deleteUser(existing.id)
          .catch(() => undefined)
        userId = await createUserWithVerifiedHash(entry, TEST_USER_PASSWORD)
      }
    } else {
      userId = await createUserWithVerifiedHash(entry, TEST_USER_PASSWORD)
    }

    // Always force the seeded password to stay logged in without the initial-change flow.
    await db
      .update(userTable)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(userTable.id, userId))

    if (entry.kind === 'profile' && entry.profileId) {
      await db
        .insert(userProfile)
        .values({
          userId,
          profileId: entry.profileId,
          assignedAt: new Date(),
          assignedByUserId: null,
        })
        .onConflictDoUpdate({
          target: userProfile.userId,
          set: {
            profileId: entry.profileId,
            assignedAt: new Date(),
          },
        })
    }

    for (const hcId of entry.extraHousingComplexIds ?? []) {
      await db
        .insert(userHousingComplex)
        .values({
          userId,
          housingComplexId: hcId,
          grantedAt: new Date(),
          grantedByUserId: null,
        })
        .onConflictDoNothing()
    }

    seeded.push({
      id: userId,
      cpf: entry.cpf,
      name: entry.name,
      email: entry.email,
      kind: entry.kind,
      profileId: entry.profileId ?? null,
      extraHousingComplexIds: entry.extraHousingComplexIds ?? [],
    })
  }

  return seeded
}
