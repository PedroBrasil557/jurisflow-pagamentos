import {
  createPlatformUser,
  generateTemporaryPassword,
} from '../modules/auth/auth.user-management.service'

type ParsedArgs = {
  cpf?: string
  email?: string
  name?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    switch (current) {
      case '--name':
        parsed.name = argv[index + 1]
        index += 1
        break
      case '--email':
        parsed.email = argv[index + 1]
        index += 1
        break
      case '--cpf':
        parsed.cpf = argv[index + 1]
        index += 1
        break
      default:
        throw new Error(`Argumento invalido: ${current}`)
    }
  }

  return parsed
}

function printUsage() {
  console.log(
    [
      'Uso:',
      '  bun run create:admin --name "Nome" --cpf "00000000000"',
      '  bun run create:admin --name "Nome" --cpf "00000000000" --email "email@empresa.com"',
    ].join('\n'),
  )
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2))

  if (!args.name || !args.cpf) {
    throw new Error('Informe nome e CPF do administrador.')
  }

  const temporaryPassword = generateTemporaryPassword()

  const result = await createPlatformUser({
    cpf: args.cpf,
    email: args.email,
    name: args.name,
    password: temporaryPassword,
    role: 'admin',
  })

  console.log('Administrador criado com sucesso.')
  console.log(`ID: ${result.user.id}`)
  console.log(`Nome: ${result.user.name}`)
  console.log(`CPF: ${result.user.cpf}`)
  console.log(`Role: ${result.user.role}`)
  console.log('Senha temporaria:')
  console.log(temporaryPassword)
  console.log('O usuario sera obrigado a trocar a senha no primeiro acesso.')
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : 'Falha ao criar o administrador.'

  console.error(message)
  printUsage()
  process.exit(1)
})
