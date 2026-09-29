import { Hono } from 'hono'

const bootstrapApp = new Hono()

const requiredEnvironmentKeys = ['DATABASE_URL', 'BETTER_AUTH_SECRET'] as const

type RuntimeApp = {
  fetch: (request: Request) => Response | Promise<Response>
}

let runtimeAppPromise: Promise<RuntimeApp> | null = null

function getRuntimeApp() {
  if (!runtimeAppPromise) {
    runtimeAppPromise = Promise.all([
      import('./src/app'),
      import('./src/shared/config/env'),
    ]).then(([appModule, envModule]) =>
      appModule.createApp({ allowedOrigins: envModule.env.trustedOrigins }),
    )
  }

  return runtimeAppPromise
}

bootstrapApp.get('/api/system/health', (c) => {
  return c.json(
    {
      ok: true,
      service: 'api',
      runtime: process.env.VERCEL ? 'vercel' : 'local',
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      timestamp: new Date().toISOString(),
    },
    200,
  )
})

bootstrapApp.get('/api/system/bootstrap-check', async (c) => {
  const missing = requiredEnvironmentKeys.filter((key) => !process.env[key])

  if (missing.length > 0) {
    return c.json(
      {
        ok: false,
        stage: 'environment',
        missing,
      },
      503,
    )
  }

  try {
    await import('./src/shared/config/env')
  } catch {
    return c.json({ ok: false, stage: 'environment-parse' }, 503)
  }

  try {
    await import('./src/shared/db')
  } catch {
    return c.json({ ok: false, stage: 'database-module' }, 503)
  }

  try {
    await import('./src/app')
  } catch {
    return c.json({ ok: false, stage: 'application-module' }, 503)
  }

  return c.json(
    {
      ok: true,
      stage: 'ready',
      runtime: process.env.VERCEL ? 'vercel' : 'local',
    },
    200,
  )
})

bootstrapApp.all('*', async (c) => {
  try {
    const app = await getRuntimeApp()
    return await app.fetch(c.req.raw)
  } catch (error) {
    console.error('Vercel API bootstrap failed', error)

    return c.json(
      {
        message: 'API temporariamente indisponivel.',
        code: 'API_BOOTSTRAP_FAILED',
      },
      503,
    )
  }
})

export default bootstrapApp
