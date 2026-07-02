import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserHolder } from './browser.ts'
import { consultarQuitacao } from './caixa-quitacao/consulta.ts'
import { GlobalSpacer } from './rate-limiter.ts'
import {
  ClaimError,
  type ClaimedJob,
  type ConsultaPdf,
  createProcessosSource,
  createTitularesSource,
  type PerCpfResult,
  type Source,
} from './sources.ts'

// Worker RPA UNIFICADO da quitacao. Um unico processo consome AMBAS as filas
// (processos + titulares) com um POOL de N slots concorrentes, sobre UM browser
// Playwright. Um espacador GLOBAL em memoria (GlobalSpacer) governa a taxa de
// INICIO das consultas ao portal da Caixa — a concorrencia so preenche as janelas
// ociosas de render (~24s) sem elevar o pico de requisicoes. Requer processo UNICO
// (o espacador e em memoria); o claim das duas filas ja e atomico (SKIP LOCKED) e
// fenceado por token, entao N slots nunca reivindicam/sobrescrevem o mesmo job.

// Remove barra(s) finais: o API Gateway (HttpApi.url) vem com '/' no fim e a
// concatenacao geraria '//api/...' -> 404 no Hono.
const API_URL = (process.env.API_URL ?? 'http://localhost:3556').replace(
  /\/+$/,
  '',
)
const TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-change-me'

// Fallbacks robustos: um valor invalido (ex.: "5s") nao pode virar NaN.
function envInt(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}
const POLL_MS = envInt('POLL_MS', 5000, 1)
// Espacamento global fixo entre inicios de consulta (freio educado ao portal).
const MIN_INTERVAL_MS = envInt('CONSULTA_MIN_INTERVAL_MS', 5000, 0)
// Slots concorrentes. Default 1 (comportamento single-flight seguro se nao setado);
// prod/compose setam explicitamente. Kill-switch: voltar para 1 recua sem redeploy.
const CONCURRENCY = envInt('CONSULTA_CONCURRENCY', 1, 1)
// Backoff maior ao detectar erro de CONFIGURACAO (404/401): nao adianta martelar a
// cada POLL_MS uma URL/rota/token errados.
const CONFIG_ERROR_BACKOFF_MS = 60_000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Liveness: um timer toca este arquivo enquanto o event-loop estiver vivo. O
// healthcheck do ECS checa a idade do arquivo (mtime) e reinicia a task se o
// processo travar — mitiga o SPOF do worker unico (crash ja e coberto pelo ECS).
const HEARTBEAT_FILE =
  process.env.HEARTBEAT_FILE ?? join(tmpdir(), 'worker-heartbeat')
function touchHeartbeat(): void {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()))
  } catch {
    // best-effort: sem heartbeat, o healthcheck reinicia (fail-safe).
  }
}

// Estado compartilhado pelos slots (single-thread; sem corrida real).
type SharedState = { running: boolean; connectedLogged: boolean }

// Reivindica de QUALQUER fila, em ordem rotativa (round-robin) para nenhuma faminta.
// Retorna o 1o job encontrado. So propaga erro se TODAS as fontes falharem sem job
// (config vence transitorio na classificacao feita pelo caller).
async function claimAny(
  sources: Source[],
  rr: { i: number },
): Promise<ClaimedJob | null> {
  const n = sources.length
  const start = rr.i++
  let configError: ClaimError | null = null
  let otherError: Error | null = null
  for (let k = 0; k < n; k++) {
    const src = sources[(start + k) % n]
    try {
      const job = await src.claim()
      if (job) {
        return job
      }
    } catch (error) {
      if (error instanceof ClaimError && error.kind === 'config') {
        configError = error
      } else {
        otherError = error as Error
      }
    }
  }
  if (configError) {
    throw configError
  }
  if (otherError) {
    throw otherError
  }
  return null
}

// Consulta os CPFs do job em sequencia, parando no 1o 'quitado' (short-circuit) —
// preserva a economia de nao consultar o 2o CPF quando o 1o ja quitou. Reporta o
// desfecho por CPF pela fonte de origem. Cada consulta passa pelo espacador global.
async function processJob(
  id: number,
  job: ClaimedJob,
  holder: BrowserHolder,
  spacer: GlobalSpacer,
): Promise<void> {
  console.log(
    `[worker#${id}] consultando ${job.label} (${job.cpfs.length} CPF(s))`,
  )
  const consultas: PerCpfResult[] = []
  let pdf: ConsultaPdf = null
  try {
    for (const cpf of job.cpfs) {
      // Pacing GLOBAL: >= MIN_INTERVAL desde o inicio de QUALQUER consulta anterior
      // (entre CPFs do mesmo job e entre slots concorrentes).
      await spacer.acquire()
      const outcome = await holder.withContext((page) =>
        consultarQuitacao(page, cpf),
      )
      consultas.push({
        cpf,
        result: outcome.result,
        message: outcome.message,
      })
      // quitado -> emitiu para este CPF: guarda o pdf e PARA (short-circuit).
      // erro -> transitorio: para e re-tenta o job depois (backoff na fila).
      // nao_encontrado -> tenta o proximo CPF (se houver).
      if (outcome.result === 'quitado') {
        pdf = outcome.pdf
        break
      }
      if (outcome.result === 'erro') {
        break
      }
    }
    await job.report(consultas, pdf)
    console.log(
      `[worker#${id}] ${job.label} -> ${consultas.map((c) => c.result).join(',')}`,
    )
  } catch (error) {
    console.error(
      `[worker#${id}] erro em ${job.label}:`,
      (error as Error).message,
    )
    // Erro inesperado (browser/crash): marca todos os CPFs como 'erro' (retry).
    await job
      .report(
        job.cpfs.map((cpf) => ({
          cpf,
          result: 'erro' as const,
          message: (error as Error).message?.slice(0, 300) ?? 'erro inesperado',
        })),
        null,
      )
      .catch(() => {})
  }
}

// Loop de UM slot do pool: claim -> processa -> repete, ate o shutdown.
async function runSlot(
  id: number,
  sources: Source[],
  holder: BrowserHolder,
  spacer: GlobalSpacer,
  rr: { i: number },
  state: SharedState,
): Promise<void> {
  while (state.running) {
    let job: ClaimedJob | null = null
    try {
      job = await claimAny(sources, rr)
    } catch (error) {
      if (error instanceof ClaimError && error.kind === 'config') {
        console.error(
          `[worker#${id}] ERRO DE CONFIGURACAO no claim: ${error.message}`,
        )
        await sleep(CONFIG_ERROR_BACKOFF_MS)
        continue
      }
      console.error(
        `[worker#${id}] claim falhou (transitorio): ${(error as Error).message}`,
      )
      await sleep(POLL_MS)
      continue
    }

    if (!state.connectedLogged) {
      state.connectedLogged = true
      console.log(`[worker] conectado a API (${API_URL}) — claim OK.`)
    }

    if (!job) {
      await sleep(POLL_MS)
      continue
    }

    await processJob(id, job, holder, spacer)
  }
}

async function main(): Promise<void> {
  const cfg = { apiUrl: API_URL, token: TOKEN }
  const sources: Source[] = [
    createProcessosSource(cfg),
    createTitularesSource(cfg),
  ]
  const holder = new BrowserHolder()
  const spacer = new GlobalSpacer({ minIntervalMs: MIN_INTERVAL_MS })
  const state: SharedState = { running: true, connectedLogged: false }
  const rr = { i: 0 }

  const stop = () => {
    state.running = false
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)

  // Heartbeat de liveness (independente do trabalho dos slots): detecta travamento
  // do event-loop. unref() para nao segurar o processo no shutdown.
  touchHeartbeat()
  const heartbeat = setInterval(touchHeartbeat, 10_000)
  heartbeat.unref()

  console.log(
    `[worker] iniciado. API=${API_URL} poll=${POLL_MS}ms interval=${MIN_INTERVAL_MS}ms concurrency=${CONCURRENCY}`,
  )

  // Pool: N slots concorrentes drenando as duas filas sob um espacador global.
  const slots = Array.from({ length: CONCURRENCY }, (_, i) =>
    runSlot(i + 1, sources, holder, spacer, rr, state),
  )
  // Shutdown gracioso: cada slot encerra apos terminar o job em voo.
  await Promise.all(slots)

  await holder.close()
  console.log('[worker] encerrado')
  process.exit(0)
}

main().catch((error) => {
  console.error('[worker] fatal:', error)
  process.exit(1)
})
