import { eq } from 'drizzle-orm'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { appSettings } from './settings.schema'

const SETTINGS_ID = 'default'

export type AnthropicKeySource = 'database' | 'environment' | null

export type AnthropicKeyStatus = {
  configured: boolean
  last4: string | null
  source: AnthropicKeySource
}

// Le a chave salva no banco (texto puro), ou null se nao houver.
export async function getAnthropicApiKey(): Promise<string | null> {
  const [row] = await db
    .select({ anthropicApiKey: appSettings.anthropicApiKey })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .limit(1)

  const key = row?.anthropicApiKey?.trim()

  return key ? key : null
}

// Status da chave efetiva (banco tem prioridade sobre o env).
// Nunca retorna a chave inteira — apenas configured/last4/source.
export async function getAnthropicKeyStatus(): Promise<AnthropicKeyStatus> {
  const dbKey = await getAnthropicApiKey()

  if (dbKey) {
    return { configured: true, last4: dbKey.slice(-4), source: 'database' }
  }

  const envKey = env.anthropic.apiKey?.trim()

  if (envKey) {
    return { configured: true, last4: envKey.slice(-4), source: 'environment' }
  }

  return { configured: false, last4: null, source: null }
}

export async function saveAnthropicApiKey(
  key: string,
): Promise<AnthropicKeyStatus> {
  const trimmed = key.trim()
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      anthropicApiKey: trimmed,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { anthropicApiKey: trimmed, updatedAt: now },
    })

  return getAnthropicKeyStatus()
}

export async function clearAnthropicApiKey(): Promise<AnthropicKeyStatus> {
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      anthropicApiKey: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { anthropicApiKey: null, updatedAt: now },
    })

  return getAnthropicKeyStatus()
}
