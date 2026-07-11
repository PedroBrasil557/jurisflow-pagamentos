import { queryOptions } from '@tanstack/react-query'
import { apiClient } from '@/shared/services/api-client'

// Fallback de dev/build: a license tambem pode vir de uma variavel do front.
const envKey = (import.meta.env.VITE_SCANBOT_LICENSE_KEY ?? '').trim()

// Busca a license salva nas Configuracoes (via API). Qualquer usuario autenticado
// pode ler — o scanner precisa dela no navegador para iniciar o Scanbot SDK.
async function fetchScanbotLicense(): Promise<string | null> {
  try {
    const response = await apiClient.api.settings['scanbot-license'].$get()

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as { licenseKey: string | null }
    return data.licenseKey
  } catch {
    return null
  }
}

export const scanbotLicenseQuery = queryOptions({
  queryKey: ['scanbot-license'] as const,
  queryFn: fetchScanbotLicense,
  staleTime: 5 * 60 * 1000,
})

// Chave efetiva no cliente: a salva no painel (via API) tem prioridade; sem ela,
// usa o env de build. Vazia => Scanbot indisponivel (cai no scanner do navegador).
export function resolveScanbotKey(apiKey: string | null | undefined): string {
  return (apiKey ?? '').trim() || envKey
}

// --- Servico de digitalizacao escolhido no painel ---
// 'docaligner' = scanner do navegador com deteccao por IA (padrao). 'scan-hd' =
// mesmo scanner em modo HD (still do sensor no Android + gate de qualidade).
// 'scanbot' = SDK licenciado. O antigo 'web' (OpenCV/jscanify) foi removido.
export type ScannerProvider = 'scanbot' | 'docaligner' | 'scan-hd'

// Normaliza o valor salvo: migra o legado 'web' (e qualquer valor desconhecido)
// para 'docaligner'. So 'scanbot' e 'scan-hd' permanecem como estao.
function normalizeProvider(value: string | null | undefined): ScannerProvider {
  if (value === 'scanbot' || value === 'scan-hd') {
    return value
  }
  return 'docaligner'
}

async function fetchScannerProvider(): Promise<ScannerProvider> {
  try {
    const response = await apiClient.api.settings['scanner-provider'].$get()
    if (!response.ok) {
      return 'docaligner'
    }
    const data = (await response.json()) as { provider: string | null }
    return normalizeProvider(data.provider)
  } catch {
    return 'docaligner'
  }
}

export const scannerProviderQuery = queryOptions({
  queryKey: ['scanner-provider'] as const,
  queryFn: fetchScannerProvider,
  staleTime: 5 * 60 * 1000,
})

// --- Versao ativa do tuning de deteccao/recorte de borda ---
// So a string da versao trafega; o dialog resolve versao -> valores via
// resolveTuning (scanner-tuning.ts) e cai no default se for desconhecida.
async function fetchScannerTuningVersion(): Promise<string | null> {
  try {
    const response =
      await apiClient.api.settings['scanner-tuning-version'].$get()
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as { version: string | null }
    return data.version
  } catch {
    return null
  }
}

export const scannerTuningQuery = queryOptions({
  queryKey: ['scanner-tuning-version'] as const,
  queryFn: fetchScannerTuningVersion,
  staleTime: 5 * 60 * 1000,
})
