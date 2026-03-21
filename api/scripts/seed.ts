import { eq } from 'drizzle-orm'
import { db } from '../src/shared/db'
import { user as userTable } from '../src/modules/auth/auth.schema'
import {
  createPlatformUser,
  generateTemporaryPassword,
} from '../src/modules/auth/auth.user-management.service'

const ADMIN_CPF = process.env.ADMIN_CPF ?? '12345678909'
const ADMIN_NAME = process.env.ADMIN_NAME ?? 'Administrador'

async function seed() {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.role, 'admin'))
    .limit(1)

  if (existing) {
    console.log('Admin already exists, skipping seed.')
    return
  }

  const password = generateTemporaryPassword()

  const result = await createPlatformUser({
    cpf: ADMIN_CPF,
    name: ADMIN_NAME,
    password,
    role: 'admin',
  })

  console.log('Admin created successfully.')
  console.log(`CPF: ${result.user.cpf}`)
  console.log(`Password: ${password}`)
  console.log('User must change password on first access.')
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
