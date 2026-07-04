import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserHolder } from './browser.ts'
import {
  type ConsultaQuitacaoOutcome,
  consultarQuitacao,
} from './caixa-quitacao/consulta.ts'
import { type BreakerSignal, PortalBreaker } from './circuit-breaker.ts'
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
//
// Seguranca ao acelerar (degrau 5 = ~5.000/h): um FREIO automatico (PortalBreaker)
// que SO DESACELERA governa a taxa em tempo real (desacelera/pausa/trava piso quando
// o portal reclama); um SLOW-START rampa a concorrencia na partida para o breaker
// acumular sinais antes de saturar; e cada consulta emite telemetria PII-safe.

// Remove barra(s) finais: o API Gateway (HttpApi.url) vem com '/' no fim e a
// concatenacao geraria '//api/...' -> 404 no Hono.
const API_URL = (process.env.API_URL ?? 'http://localhost:3556').replace(
  /\/+$/,
  '',
)
const TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-change-me'
// Identidade da replica na topologia multi-IP (1 task = 1 IP de saida). Vai na
// telemetria e nos logs de boot p/ analise per-IP no Logs Insights.
const WORKER_ID = process.env.WORKER_ID ?? 'default'

// Fallbacks robustos: um valor invalido (ex.: "5s") nao pode virar NaN.
function envInt(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}
const POLL_MS = envInt('POLL_MS', 5000, 1)
// Espacamento global BASE entre inicios de consulta (o "botao de taxa" / degrau).
// O freio nunca acelera abaixo disto; so pode ficar mais lento (piso travado/slow).
const MIN_INTERVAL_MS = envInt('CONSULTA_MIN_INTERVAL_MS', 5000, 0)
// Slots concorrentes. Default 1 (comportamento single-flight seguro se nao setado);
// prod/compose setam explicitamente. Kill-switch: voltar para 1 recua sem redeploy.
const CONCURRENCY = envInt('CONSULTA_CONCURRENCY', 1, 1)
// Rampa de partida: sobe a concorrencia de 0 -> CONCURRENCY ao longo deste tempo,
// para o breaker acumular ~10 amostras antes de saturar (0 desliga = abre tudo ja).
const SLOW_START_MS = envInt('SLOW_START_MS', 0, 0)
// Freio de seguranca (default ligado; '0' desliga — so debug, ligado e mais seguro).
const BREAKER_ENABLED = (process.env.BREAKER_ENABLED ?? '1') !== '0'
// Bloqueio de recursos nao-essenciais por consulta (imagens/fontes/analytics).
const BLOCK_RESOURCES = (process.env.BLOCK_RESOURCES ?? '0') === '1'
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

// Loga o IP publico de saida no boot (best-effort, nunca derruba o worker): prova
// no CloudWatch que cada replica multi-IP saiu por um NAT/EIP distinto.
async function logEgressIp(): Promise<void> {
  try {
    const res = await fetch('https://checkip.amazonaws.com', {
      signal: AbortSignal.timeout(5000),
    })
    const ip = (await res.text()).trim()
    console.log(`[worker] worker=${WORKER_ID} egress_ip=${ip}`)
  } catch (error) {
    console.log(
      `[worker] worker=${WORKER_ID} egress_ip=indisponivel (${(error as Error).message})`,
    )
  }
}

// Mapeia o desfecho de uma consulta ao sinal que o freio consome. 'cpf_invalido'
// e nossa validacao local (nunca tocou o portal) -> nao conta. 'pagina_inesperada'
// e o sentinela (captcha/manutencao). Qualquer outro 'erro' e estresse do portal.
function breakerSignal(outcome: ConsultaQuitacaoOutcome): BreakerSignal | null {
  if (outcome.result === 'quitado' || outcome.result === 'nao_encontrado') {
    return 'ok'
  }
  if (outcome.reason === 'cpf_invalido') {
    return null
  }
  if (outcome.reason === 'pagina_inesperada') {
    return 'sentinel'
  }
  return 'stress'
}

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

// Contexto de pacing/telemetria passado aos slots.
type Pacing = {
  spacer: GlobalSpacer
  breaker: PortalBreaker
  // Intervalo efetivo AGORA (base, piso travado e fator do freio) — so p/ telemetria.
  currentIntervalMs: () => number
}

// Consulta os CPFs do job em sequencia, parando no 1o 'quitado' (short-circuit) —
// preserva a economia de nao consultar o 2o CPF quando o 1o ja quitou. Reporta o
// desfecho por CPF pela fonte de origem. Cada consulta passa pelo espacador global,
// alimenta o freio e emite uma linha de telemetria PII-safe.
async function processJob(
  id: number,
  job: ClaimedJob,
  holder: BrowserHolder,
  pacing: Pacing,
): Promise<void> {
  console.log(
    `[worker#${id}] consultando ${job.label} (${job.cpfs.length} CPF(s))`,
  )
  const consultas: PerCpfResult[] = []
  let pdf: ConsultaPdf = null
  try {
    for (const cpf of job.cpfs) {
      // Pacing GLOBAL: >= intervalo desde o inicio de QUALQUER consulta anterior
      // (entre CPFs do mesmo job e entre slots concorrentes).
      await pacing.spacer.acquire()
      const intervalMs = pacing.currentIntervalMs()
      const startedAt = Date.now()
      const outcome = await holder.withContext((page) =>
        consultarQuitacao(page, cpf),
      )
      const durationMs = Date.now() - startedAt
      consultas.push({
        cpf,
        result: outcome.result,
        message: outcome.message,
      })
      // Telemetria PII-safe (NUNCA o CPF): insumo de L (durationMs), taxa de erro
      // (result/reason) e mix p/ os go/no-go da rampa via Logs Insights.
      console.log(
        `[telemetria] ${JSON.stringify({
          ts: new Date().toISOString(),
          worker: WORKER_ID,
          source: job.source,
          result: outcome.result,
          reason: outcome.reason ?? null,
          durationMs,
          intervalMs: Math.round(intervalMs),
        })}`,
      )
      if (BREAKER_ENABLED) {
        const signal = breakerSignal(outcome)
        if (signal) {
          pacing.breaker.record(signal)
        }
      }
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
  pacing: Pacing,
  rr: { i: number },
  state: SharedState,
): Promise<void> {
  while (state.running) {
    // Gate de pausa do freio: ANTES do claim (nunca com job em maos — pausar
    // segurando um job estouraria o lease de 600s e permitiria re-claim duplicado).
    if (BREAKER_ENABLED) {
      const until = pacing.breaker.pausedUntilMs()
      const now = Date.now()
      if (until > now) {
        await sleep(Math.min(POLL_MS, until - now))
        continue
      }
    }

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

    await processJob(id, job, holder, pacing)
  }
}

async function main(): Promise<void> {
  const cfg = { apiUrl: API_URL, token: TOKEN }
  const sources: Source[] = [
    createProcessosSource(cfg),
    createTitularesSource(cfg),
  ]
  const holder = new BrowserHolder({ blockResources: BLOCK_RESOURCES })
  const breaker = new PortalBreaker()
  // Intervalo efetivo = max(base, piso travado do freio) * fator do freio. O freio
  // SO desacelera: max(...) garante que nunca fica abaixo do BASE configurado.
  const currentIntervalMs = (): number => {
    if (!BREAKER_ENABLED) {
      return MIN_INTERVAL_MS
    }
    return (
      Math.max(MIN_INTERVAL_MS, breaker.floorIntervalMs()) *
      breaker.intervalFactor()
    )
  }
  const spacer = new GlobalSpacer({ minIntervalMs: currentIntervalMs })
  const pacing: Pacing = { spacer, breaker, currentIntervalMs }
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
    `[worker] iniciado. worker=${WORKER_ID} API=${API_URL} poll=${POLL_MS}ms base_interval=${MIN_INTERVAL_MS}ms concurrency=${CONCURRENCY} slow_start=${SLOW_START_MS}ms breaker=${BREAKER_ENABLED} block_resources=${BLOCK_RESOURCES}`,
  )
  await logEgressIp()

  // Pool: N slots concorrentes drenando as duas filas sob um espacador global.
  // SLOW-START: cria os slots escalonados (0 -> N ao longo de SLOW_START_MS) para
  // o freio acumular sinais durante a subida e poder frear/pausar antes de saturar.
  const stepMs =
    SLOW_START_MS > 0 && CONCURRENCY > 1
      ? Math.floor(SLOW_START_MS / CONCURRENCY)
      : 0
  const slots: Promise<void>[] = []
  for (let i = 0; i < CONCURRENCY; i++) {
    if (!state.running) {
      break
    }
    slots.push(runSlot(i + 1, sources, holder, pacing, rr, state))
    if (stepMs > 0 && i < CONCURRENCY - 1) {
      await sleep(stepMs)
    }
  }
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
