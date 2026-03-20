import type { auth } from '../../modules/auth/auth.service'

export type AppBindings = {
  Variables: {
    user: typeof auth.$Infer.Session.user | null
    session: typeof auth.$Infer.Session.session | null
  }
}
