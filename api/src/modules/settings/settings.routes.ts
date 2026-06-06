import { Hono } from 'hono'
import { requireRole } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { jsonValidator } from '../../shared/validation/validators'
import { saveAnthropicKeyPayloadSchema } from './settings.schemas'
import {
  clearAnthropicApiKey,
  getAnthropicKeyStatus,
  saveAnthropicApiKey,
} from './settings.service'

export const settingsAdminRoutes = new Hono<AppBindings>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => {
    try {
      const status = await getAnthropicKeyStatus()

      return c.json(status, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .put(
    '/anthropic-key',
    jsonValidator(saveAnthropicKeyPayloadSchema),
    async (c) => {
      try {
        const status = await saveAnthropicApiKey(
          c.req.valid('json').anthropicApiKey,
        )

        return c.json(
          { message: 'Chave da API salva com sucesso.', status },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete('/anthropic-key', async (c) => {
    try {
      const status = await clearAnthropicApiKey()

      return c.json({ message: 'Chave da API removida.', status }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
