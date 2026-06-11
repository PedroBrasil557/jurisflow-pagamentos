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
  provider: z.enum(['scanbot', 'web', 'docaligner']),
})

export type SaveScannerProviderPayload = z.infer<
  typeof saveScannerProviderPayloadSchema
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
