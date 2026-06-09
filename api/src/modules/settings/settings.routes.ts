import { Hono } from 'hono'
import { requireAuth, requireRole } from '../../shared/middleware/auth-guard'
import { handleServiceError } from '../../shared/middleware/error-handler'
import type { AppBindings } from '../../shared/types/app'
import { jsonValidator } from '../../shared/validation/validators'
import {
  saveAnthropicKeyPayloadSchema,
  saveScanbotKeyPayloadSchema,
  saveScannerProviderPayloadSchema,
} from './settings.schemas'
import {
  clearAnthropicApiKey,
  clearScanbotLicenseKey,
  getAnthropicKeyStatus,
  getScanbotKeyStatus,
  getScanbotLicenseKey,
  getScannerProvider,
  saveAnthropicApiKey,
  saveScanbotLicenseKey,
  saveScannerProvider,
} from './settings.service'

export const settingsAdminRoutes = new Hono<AppBindings>()
  .use('*', requireRole('admin'))
  .get('/', async (c) => {
    try {
      const [anthropic, scanbot, scannerProvider] = await Promise.all([
        getAnthropicKeyStatus(),
        getScanbotKeyStatus(),
        getScannerProvider(),
      ])

      return c.json(
        { anthropic, scanbot, scanner: { provider: scannerProvider } },
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .put(
    '/scanner-provider',
    jsonValidator(saveScannerProviderPayloadSchema),
    async (c) => {
      try {
        const result = await saveScannerProvider(c.req.valid('json').provider)

        return c.json(
          { message: 'Servico de digitalizacao atualizado.', scanner: result },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
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
  .put(
    '/scanbot-license',
    jsonValidator(saveScanbotKeyPayloadSchema),
    async (c) => {
      try {
        const status = await saveScanbotLicenseKey(
          c.req.valid('json').scanbotLicenseKey,
        )

        return c.json(
          { message: 'License key do Scanbot salva com sucesso.', status },
          200,
        )
      } catch (error) {
        return handleServiceError(c, error)
      }
    },
  )
  .delete('/scanbot-license', async (c) => {
    try {
      const status = await clearScanbotLicenseKey()

      return c.json(
        { message: 'License key do Scanbot removida.', status },
        200,
      )
    } catch (error) {
      return handleServiceError(c, error)
    }
  })

// Endpoint para qualquer usuario autenticado: o scanner precisa da license
// inteira no navegador para inicializar o Scanbot Web SDK (chave travada por
// dominio, nao e segredo real).
export const settingsClientRoutes = new Hono<AppBindings>()
  .use('*', requireAuth())
  .get('/scanbot-license', async (c) => {
    try {
      const licenseKey = await getScanbotLicenseKey()

      return c.json({ licenseKey }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
  .get('/scanner-provider', async (c) => {
    try {
      const provider = await getScannerProvider()

      return c.json({ provider }, 200)
    } catch (error) {
      return handleServiceError(c, error)
    }
  })
