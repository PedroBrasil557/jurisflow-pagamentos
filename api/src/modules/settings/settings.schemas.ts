import { z } from 'zod'

export const saveAnthropicKeyPayloadSchema = z.object({
  anthropicApiKey: z.string().trim().min(1, {
    message: 'Informe a chave da API.',
  }),
})

export type SaveAnthropicKeyPayload = z.infer<
  typeof saveAnthropicKeyPayloadSchema
>
