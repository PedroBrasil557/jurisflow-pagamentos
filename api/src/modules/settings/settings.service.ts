import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { appSettings } from './settings.schema'
import type { saveScannerProviderPayloadSchema } from './settings.schemas'

const SETTINGS_ID = 'default'

export type KeySource = 'database' | 'environment' | null

export type KeyStatus = {
  configured: boolean
  last4: string | null
  source: KeySource
}

// Mantido por compatibilidade com importacoes existentes.
export type AnthropicKeySource = KeySource
export type AnthropicKeyStatus = KeyStatus

// Flag de auto-aplicacao do contrato Caixa (default false = shadow).
export async function getCaixaOwnerAutoApply(): Promise<boolean> {
  const [row] = await db
    .select({ caixaOwnerAutoApply: appSettings.caixaOwnerAutoApply })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .limit(1)

  return row?.caixaOwnerAutoApply ?? false
}

export async function saveCaixaOwnerAutoApply(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      caixaOwnerAutoApply: enabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { caixaOwnerAutoApply: enabled, updatedAt: now },
    })

  return { enabled }
}

// Flag de auto-aplicacao do conjunto via procuracao (default false = shadow).
export async function getProcuracaoConjuntoAutoApply(): Promise<boolean> {
  const [row] = await db
    .select({
      procuracaoConjuntoAutoApply: appSettings.procuracaoConjuntoAutoApply,
    })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .limit(1)

  return row?.procuracaoConjuntoAutoApply ?? false
}

export async function saveProcuracaoConjuntoAutoApply(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      procuracaoConjuntoAutoApply: enabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { procuracaoConjuntoAutoApply: enabled, updatedAt: now },
    })

  return { enabled }
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

// --- Scanbot Web SDK license key ---
// Diferente da chave Anthropic (so-servidor), esta precisa chegar ao navegador
// para inicializar o SDK. E travada por dominio, entao nao e segredo real.

// Le a license inteira salva no banco (texto puro), ou null se nao houver.
export async function getScanbotLicenseKey(): Promise<string | null> {
  const [row] = await db
    .select({ scanbotLicenseKey: appSettings.scanbotLicenseKey })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .limit(1)

  const key = row?.scanbotLicenseKey?.trim()

  return key ? key : null
}

// Status para o painel admin. Nunca retorna a chave inteira.
export async function getScanbotKeyStatus(): Promise<KeyStatus> {
  const dbKey = await getScanbotLicenseKey()

  if (dbKey) {
    return { configured: true, last4: dbKey.slice(-4), source: 'database' }
  }

  return { configured: false, last4: null, source: null }
}

export async function saveScanbotLicenseKey(key: string): Promise<KeyStatus> {
  const trimmed = key.trim()
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      scanbotLicenseKey: trimmed,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { scanbotLicenseKey: trimmed, updatedAt: now },
    })

  return getScanbotKeyStatus()
}

// --- Servico de digitalizacao (escolha explicita no painel) ---

// 'docaligner' = scanner do navegador com deteccao por IA (padrao). 'scan-hd' =
// mesmo scanner em modo HD (still do sensor no Android + gate de qualidade).
// 'scanbot' = SDK licenciado. O antigo 'web' (OpenCV/jscanify) foi removido e
// migra p/ docaligner. Fonte unica: o enum do payload de save (settings.schemas).
export type ScannerProvider = z.infer<
  typeof saveScannerProviderPayloadSchema
>['provider']

// Provedor efetivo: o salvo no painel; se nao houver escolha, usa 'scanbot'
// quando ha license configurada, senao 'docaligner'. Valores legados ('web') ou
// desconhecidos migram para 'docaligner'.
export async function getScannerProvider(): Promise<ScannerProvider> {
  const [row] = await db
    .select({ scannerProvider: appSettings.scannerProvider })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .limit(1)

  const stored = row?.scannerProvider
  if (stored === 'scanbot') {
    return 'scanbot'
  }
  if (stored === 'docaligner') {
    return 'docaligner'
  }
  if (stored === 'scan-hd') {
    return 'scan-hd'
  }
  if (stored === 'web') {
    return 'docaligner'
  }

  const hasLicense = (await getScanbotLicenseKey()) !== null
  return hasLicense ? 'scanbot' : 'docaligner'
}

export async function saveScannerProvider(
  provider: ScannerProvider,
): Promise<{ provider: ScannerProvider }> {
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      scannerProvider: provider,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { scannerProvider: provider, updatedAt: now },
    })

  return { provider }
}

// --- Tuning de deteccao/recorte de borda (versao ativa) ---
// So a versao e persistida; o web mapeia versao -> valores (scanner-tuning.ts) e
// cai no default se a versao for desconhecida. Default mantido em sincronia com
// DEFAULT_TUNING_VERSION do web.
const DEFAULT_SCANNER_TUNING_VERSION = 'v2-margin3-fullframe'

export async function getScannerTuningVersion(): Promise<string> {
  const [row] = await db
    .select({ scannerTuningVersion: appSettings.scannerTuningVersion })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .limit(1)

  return row?.scannerTuningVersion?.trim() || DEFAULT_SCANNER_TUNING_VERSION
}

export async function saveScannerTuningVersion(
  version: string,
): Promise<{ version: string }> {
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      scannerTuningVersion: version,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { scannerTuningVersion: version, updatedAt: now },
    })

  return { version }
}

export async function clearScanbotLicenseKey(): Promise<KeyStatus> {
  const now = new Date()

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      scanbotLicenseKey: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { scanbotLicenseKey: null, updatedAt: now },
    })

  return getScanbotKeyStatus()
}
