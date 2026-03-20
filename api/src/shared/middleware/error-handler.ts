import type { Context } from 'hono'
import { ServiceError } from '../errors/service-error'
import type { AppBindings } from '../types/app'

export function handleServiceError(c: Context<AppBindings>, error: unknown) {
  if (error instanceof ServiceError) {
    return c.json({ message: error.message }, error.statusCode)
  }

  throw error
}
