import { Hono } from 'hono'

const bootstrapApp = new Hono()

const requiredEnvironmentKeys = ['DATABASE_URL', 'BETTER_AUTH_SECRET'] as const

type RuntimeApp = {
  fetch: (request: Request) => Response | Promise<Response>
}

type ModuleProbe = {
  name: string
  load: () => Promise<unknown>
}

const routeModuleProbes: ModuleProbe[] = [
  { name: 'admin.routes', load: () => import('./src/modules/admin/admin.routes') },
  { name: 'auth.routes', load: () => import('./src/modules/auth/auth.routes') },
  { name: 'auth.service', load: () => import('./src/modules/auth/auth.service') },
  {
    name: 'auth-audit.routes',
    load: () => import('./src/modules/auth-audit/auth-audit.routes'),
  },
  {
    name: 'caixa-quitacao.routes',
    load: () => import('./src/modules/caixa-quitacao/caixa-quitacao.routes'),
  },
  {
    name: 'dashboard.routes',
    load: () => import('./src/modules/dashboard/dashboard.routes'),
  },
  {
    name: 'housing-complexes.routes',
    load: () => import('./src/modules/housing-complexes/housing-complexes.routes'),
  },
  {
    name: 'permissions.admin.routes',
    load: () => import('./src/modules/permissions/permissions.admin.routes'),
  },
  {
    name: 'processes.routes',
    load: () => import('./src/modules/processes/processes.routes'),
  },
  {
    name: 'quitacao-queue.internal.routes',
    load: () => import('./src/modules/quitacao-queue/quitacao-queue.internal.routes'),
  },
  {
    name: 'settings.routes',
    load: () => import('./src/modules/settings/settings.routes'),
  },
  {
    name: 'titulares-caixa.routes',
    load: () => import('./src/modules/titulares-caixa/titulares-caixa.routes'),
  },
  {
    name: 'system.routes',
    load: () => import('./src/modules/system/system.routes'),
  },
  {
    name: 'telemetry.routes',
    load: () => import('./src/modules/telemetry/telemetry.routes'),
  },
  {
    name: 'middleware.cors',
    load: () => import('./src/shared/middleware/cors'),
  },
  {
    name: 'middleware.logger',
    load: () => import('./src/shared/middleware/logger'),
  },
  {
    name: 'middleware.request-id',
    load: () => import('./src/shared/middleware/request-id'),
  },
  {
    name: 'middleware.session',
    load: () => import('./src/shared/middleware/session'),
  },
  { name: 'routes.index', load: () => import('./src/routes') },
  { name: 'app', load: () => import('./src/app') },
]

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

bootstrapApp.get('/api/system/auth-origin-check', async (c) => {
  const { env } = await import('./src/shared/config/env')

  return c.json(
    {
      ok: true,
      request: {
        origin: c.req.header('origin') ?? null,
        host: c.req.header('host') ?? null,
        forwardedHost: c.req.header('x-forwarded-host') ?? null,
        forwardedProto: c.req.header('x-forwarded-proto') ?? null,
      },
      auth: {
        betterAuthUrl: env.betterAuthUrl,
        webUrl: env.webUrl,
        trustedOrigins: env.trustedOrigins,
      },
      vercel: {
        environment: process.env.VERCEL_ENV ?? null,
        deploymentUrl: process.env.VERCEL_URL ?? null,
        productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      },
    },
    200,
  )
})

bootstrapApp.get('/api/system/module-check', async (c) => {
  const loaded: string[] = []

  for (const probe of routeModuleProbes) {
    try {
      await probe.load()
      loaded.push(probe.name)
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      const errorMessage =
        error instanceof Error ? error.message.slice(0, 300) : 'unknown error'

      console.error('Vercel module probe failed', {
        module: probe.name,
        error,
      })

      return c.json(
        {
          ok: false,
          stage: 'module-import',
          module: probe.name,
          errorName,
          errorMessage,
          loaded,
        },
        503,
      )
    }
  }

  return c.json(
    {
      ok: true,
      stage: 'all-modules-loaded',
      loaded,
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
