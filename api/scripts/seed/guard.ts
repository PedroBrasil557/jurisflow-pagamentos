const allowedHostnames = new Set(['localhost', '127.0.0.1', '::1', 'db'])

function parseDatabaseHost(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl)
    return url.hostname
  } catch {
    return null
  }
}

export function assertSeedIsLocalOnly() {
  const nodeEnv = process.env.NODE_ENV ?? 'development'

  if (nodeEnv === 'production') {
    throw new Error(
      'Seed bloqueado: NODE_ENV=production. Nao rode este script em producao.',
    )
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'Seed bloqueado: DATABASE_URL nao definida. Esperado apontar para um banco local.',
    )
  }

  const host = parseDatabaseHost(databaseUrl)
  if (!host) {
    throw new Error(
      'Seed bloqueado: nao foi possivel interpretar o host de DATABASE_URL.',
    )
  }

  if (!allowedHostnames.has(host)) {
    throw new Error(
      [
        'Seed bloqueado: DATABASE_URL aponta para um host externo.',
        `Host detectado: "${host}".`,
        `Hosts permitidos: ${Array.from(allowedHostnames).join(', ')}.`,
        'Este script e destinado apenas ao ambiente local.',
      ].join(' '),
    )
  }
}
