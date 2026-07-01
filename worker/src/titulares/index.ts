import { type Browser, chromium } from 'playwright'
import { consultarQuitacao } from '../caixa-quitacao/consulta.ts'

// Worker RPA dos TITULARES de contrato Caixa. Processo separado do worker de
// processos (index.ts). REUSA o robo do portal (consultarQuitacao) — que e
// domain-agnostico — mas fala com a FILA GENERICA (/api/internal/quitacao), sem
// nenhum acoplamento ao fluxo legado de processos.

const API_URL = (process.env.API_URL ?? 'http://localhost:3556').replace(
  /\/+$/,
  '',
)
const TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-change-me'
const parsedPoll = Number(process.env.POLL_MS)
const POLL_MS =
  Number.isFinite(parsedPoll) && parsedPoll > 0 ? parsedPoll : 5000
// Pacing GLOBAL: intervalo minimo entre QUAISQUER consultas ao site da Caixa.
const parsedInterval = Number(process.env.CONSULTA_MIN_INTERVAL_MS)
const MIN_INTERVAL_MS =
  Number.isFinite(parsedInterval) && parsedInterval >= 0 ? parsedInterval : 5000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const CONFIG_ERROR_BACKOFF_MS = 60_000

// Job da fila generica: 1 CPF por titular (subjectId = id do titular). O
// leaseToken correlaciona o /result com o claim vigente (fencing na API).
type Job = {
  jobId: string
  leaseToken: string
  subjectType: string
  subjectId: string
  cpf: string
}

class ClaimError extends Error {
  constructor(
    readonly kind: 'config' | 'transient',
    message: string,
  ) {
    super(message)
    this.name = 'ClaimError'
  }
}

async function claimJob(): Promise<Job | null> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/internal/quitacao/claim`, {
      method: 'POST',
      headers: { 'x-internal-token': TOKEN },
    })
  } catch (error) {
    throw new ClaimError(
      'transient',
      `rede: ${error instanceof Error ? error.message : 'falha'}`,
    )
  }

  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new ClaimError(
      'config',
      `HTTP ${res.status} em ${API_URL}/api/internal/quitacao/claim — confira API_URL, a rota e o INTERNAL_API_TOKEN.`,
    )
  }
  if (!res.ok) {
    throw new ClaimError('transient', `HTTP ${res.status}`)
  }

  const data = (await res.json()) as { job: Job | null }
  return data.job
}

async function reportResult(
  job: Job,
  outcome: {
    result: 'quitado' | 'nao_encontrado' | 'erro'
    message?: string
    pdf: { filename: string; bytes: Buffer } | null
  },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/internal/quitacao/result`, {
    method: 'POST',
    headers: { 'x-internal-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      result: outcome.result,
      message: outcome.message,
      pdfBase64: outcome.pdf ? outcome.pdf.bytes.toString('base64') : null,
      pdfFilename: outcome.pdf?.filename ?? null,
    }),
  })
  if (!res.ok) {
    throw new Error(`result HTTP ${res.status}`)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  let browser: Browser = await chromium.launch({ headless: true })
  let running = true
  const stop = () => {
    running = false
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  console.log(
    `[titulares-worker] iniciado. API=${API_URL} poll=${POLL_MS}ms interval=${MIN_INTERVAL_MS}ms`,
  )

  let lastConsultaAt = 0
  let connectedLogged = false

  while (running) {
    let job: Job | null = null
    try {
      job = await claimJob()
    } catch (error) {
      if (error instanceof ClaimError && error.kind === 'config') {
        console.error(
          `[titulares-worker] ERRO DE CONFIGURACAO no claim: ${error.message}`,
        )
        await sleep(CONFIG_ERROR_BACKOFF_MS)
        continue
      }
      console.error(
        `[titulares-worker] claim falhou (transitorio): ${(error as Error).message}`,
      )
      await sleep(POLL_MS)
      continue
    }

    if (!connectedLogged) {
      connectedLogged = true
      console.log(`[titulares-worker] conectado a API (${API_URL}) — claim OK.`)
    }

    if (!job) {
      await sleep(POLL_MS)
      continue
    }

    console.log(
      `[titulares-worker] consultando titular=${job.subjectId} (job=${job.jobId})`,
    )
    try {
      // Pacing GLOBAL antes de bater no site.
      const waitMs = lastConsultaAt + MIN_INTERVAL_MS - Date.now()
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      lastConsultaAt = Date.now()

      let ctx: Awaited<ReturnType<Browser['newContext']>> | null = null
      let outcome: Awaited<ReturnType<typeof consultarQuitacao>>
      try {
        if (!browser.isConnected()) {
          console.warn('[titulares-worker] browser desconectado; relancando')
          browser = await chromium.launch({ headless: true })
        }
        ctx = await browser.newContext({
          acceptDownloads: true,
          userAgent: USER_AGENT,
        })
        const page = await ctx.newPage()
        outcome = await consultarQuitacao(page, job.cpf)
      } finally {
        if (ctx) {
          await ctx.close().catch(() => {})
        }
      }

      await reportResult(job, outcome)
      console.log(
        `[titulares-worker] titular=${job.subjectId} -> ${outcome.result}`,
      )
    } catch (error) {
      console.error(
        `[titulares-worker] erro no titular=${job.subjectId}:`,
        (error as Error).message,
      )
      // Erro inesperado (browser/crash): reporta 'erro' (o job re-tenta via backoff).
      await reportResult(job, {
        result: 'erro',
        message: (error as Error).message?.slice(0, 300) ?? 'erro inesperado',
        pdf: null,
      }).catch(() => {})
    }
  }

  await browser.close()
  console.log('[titulares-worker] encerrado')
  process.exit(0)
}

main().catch((error) => {
  console.error('[titulares-worker] fatal:', error)
  process.exit(1)
})
