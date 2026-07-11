import { z } from 'zod'

export const saveAnthropicKeyPayloadSchema = z.object({
  anthropicApiKey: z.string().trim().min(1, {
    message: 'Informe a chave da API.',
  }),
})

export type SaveAnthropicKeyPayload = z.infer<
  typeof saveAnthropicKeyPayloadSchema
>

export const saveScanbotKeyPayloadSchema = z.object({
  scanbotLicenseKey: z
    .string()
    .trim()
    .min(20, { message: 'License key do Scanbot invalida.' })
    .max(4000, { message: 'License key do Scanbot muito longa.' }),
})

export type SaveScanbotKeyPayload = z.infer<typeof saveScanbotKeyPayloadSchema>

export const saveScannerProviderPayloadSchema = z.object({
  provider: z.enum(['scanbot', 'docaligner', 'scan-hd']),
})

export type SaveScannerProviderPayload = z.infer<
  typeof saveScannerProviderPayloadSchema
>

// Versoes conhecidas do tuning do scanner. A fonte de verdade dos VALORES e o
// web (scanner-tuning.ts, SCANNER_TUNING_PRESETS); aqui so validamos a versao
// salva para rejeitar typos (o rollback e mudar esta versao). Manter em sincronia
// com as chaves de SCANNER_TUNING_PRESETS.
export const scannerTuningVersionSchema = z.enum([
  'v1-baseline',
  'v2-margin3-fullframe',
  'v3-fastvit',
  'v4-letterbox',
])

export const saveScannerTuningVersionPayloadSchema = z.object({
  version: scannerTuningVersionSchema,
})

export type SaveScannerTuningVersionPayload = z.infer<
  typeof saveScannerTuningVersionPayloadSchema
>

export const saveCaixaOwnerAutoApplyPayloadSchema = z.object({
  enabled: z.boolean(),
})

export type SaveCaixaOwnerAutoApplyPayload = z.infer<
  typeof saveCaixaOwnerAutoApplyPayloadSchema
>

export const saveProcuracaoConjuntoAutoApplyPayloadSchema = z.object({
  enabled: z.boolean(),
})

export type SaveProcuracaoConjuntoAutoApplyPayload = z.infer<
  typeof saveProcuracaoConjuntoAutoApplyPayloadSchema
>
