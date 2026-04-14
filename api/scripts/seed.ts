import { assertSeedIsLocalOnly } from './seed/guard'
import {
  housingComplexesSeed,
  seedHousingComplexes,
} from './seed/housing-complexes'
import { customProfilesSeed, seedCustomProfiles } from './seed/profiles'
import {
  seedPlatformProcesses,
  summarizeProcesses,
} from './seed/processes'
import {
  type SeededUser,
  TEST_USER_PASSWORD,
  seedPlatformUsers,
} from './seed/users'

function profileLabel(profileId: string | null) {
  if (!profileId) return '—'
  const custom = customProfilesSeed.find((profile) => profile.id === profileId)
  if (custom) return `${custom.name} (custom)`
  if (profileId === 'system_profile_default_user') return 'Usuario Padrao'
  if (profileId === 'system_profile_attorney') return 'Advogado'
  return profileId
}

function complexLabel(id: string) {
  return housingComplexesSeed.find((hc) => hc.id === id)?.name ?? id
}

function printUsersTable(users: SeededUser[]) {
  console.log('\n==============================================')
  console.log('Usuarios seedados (senha: jurisflow123)')
  console.log('==============================================')

  for (const user of users) {
    const kindLabel = user.kind === 'admin' ? 'Admin' : 'Usuario'
    const extras = user.extraHousingComplexIds.length
      ? `extras: ${user.extraHousingComplexIds.map(complexLabel).join(', ')}`
      : ''

    console.log(
      [
        `- ${user.name}`,
        `CPF: ${user.cpf}`,
        `Tipo: ${kindLabel}`,
        `Perfil: ${profileLabel(user.profileId)}`,
        extras,
      ]
        .filter(Boolean)
        .join(' | '),
    )
  }
}

function printProcessesTable() {
  const byStatus = summarizeProcesses()
  console.log('\n==============================================')
  console.log('Processos seedados (total: 18)')
  console.log('==============================================')
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`- ${status}: ${count}`)
  }
}

async function seed() {
  assertSeedIsLocalOnly()

  console.log('Seeding housing complexes...')
  await seedHousingComplexes()

  console.log('Seeding custom permission profiles...')
  await seedCustomProfiles({
    housingComplexIdsByProfileName: {
      'Agente de Documentacao': ['hc_jardim_das_flores', 'hc_vila_nova'],
      'Supervisor de Lote': ['hc_morada_do_sol'],
    },
  })

  console.log('Seeding users...')
  const users = await seedPlatformUsers()

  console.log('Seeding processes...')
  await seedPlatformProcesses(users)

  printUsersTable(users)
  printProcessesTable()

  console.log('\nSenha padrao dos usuarios de teste:', TEST_USER_PASSWORD)
  console.log('Seed concluido com sucesso.')
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed falhou:', error)
    process.exit(1)
  })
