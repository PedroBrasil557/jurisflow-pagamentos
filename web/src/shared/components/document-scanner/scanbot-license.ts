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
// usa o env de build. Vazia => Scanbot indisponivel (cai no jscanify).
export function resolveScanbotKey(apiKey: string | null | undefined): string {
  return (apiKey ?? '').trim() || envKey
}
