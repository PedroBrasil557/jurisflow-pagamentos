import {
  inferAdditionalFields,
  usernameClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { clientEnv } from '@/shared/config/client-env'

export const authClient = createAuthClient({
  baseURL: clientEnv.apiUrl,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [
    usernameClient(),
    inferAdditionalFields({
      user: {
        cpf: {
          type: 'string',
          required: true,
        },
        role: {
          type: 'string',
          required: true,
          input: false,
        },
        mustChangePassword: {
          type: 'boolean',
          required: true,
          input: false,
        },
        isActive: {
          type: 'boolean',
          required: true,
          input: false,
        },
      },
    }),
  ],
})
