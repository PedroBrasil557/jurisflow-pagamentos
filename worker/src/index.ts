import { type Browser, chromium } from 'playwright'
import { consultarQuitacao } from './caixa-quitacao/consulta.ts'

// Remove barra(s) finais: o API Gateway (HttpApi.url) vem com '/' no fim e a
// concatenacao `${API_URL}/api/...` geraria '//api/...' (barra dupla) -> 404 no
// Hono. Local (sem barra) nao expunha isso; prod expunha.
const API_URL = (process.env.API_URL ?? 'http://localhost:3556').replace(
  /\/+$/,
  '',
)
const TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-change-me'
// Fallback robusto: um POLL_MS invalido (ex.: "5s") nao pode virar NaN ->
// setTimeout(NaN)=0 -> busy-loop martelando o /claim.
const parsedPoll = Number(process.env.POLL_MS)
const POLL_MS =
  Number.isFinite(parsedPoll) && parsedPoll > 0 ? parsedPoll : 5000
// Pacing GLOBAL: intervalo minimo entre QUAISQUER consultas ao site da Caixa
// (educado / evita o throttling por taxa). Como ha 1 worker, uma variavel em
// memoria controla a taxa global. Default 5s.
const parsedInterval = Number(process.env.CONSULTA_MIN_INTERVAL_MS)
const MIN_INTERVAL_MS =
  Number.isFinite(parsedInterval) && parsedInterval >= 0 ? parsedInterval : 5000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
// Backoff maior ao detectar erro de CONFIGURACAO (404/401): nao adianta martelar
// a cada POLL_MS uma URL/rota/token errados — espera mais e mantem o log limpo.
const CONFIG_ERROR_BACKOFF_MS = 60_000

type Job = { processId: string; cpf: string }

// Erro do claim classificado: 'config' (404/401/403 — URL/rota/versao da API ou
// token errados; NAO e transitorio) vs 'transient' (5xx/rede — tentar de novo).
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
    res = await fetch(`${API_URL}/api/internal/caixa-quitacao/claim`, {
      method: 'POST',
      headers: { 'x-internal-token': TOKEN },
    })
  } catch (error) {
    // Falha de rede (DNS/conexao): nao alcancou a API. Transitorio.
    throw new ClaimError(
      'transient',
      `rede: ${error instanceof Error ? error.message : 'falha'}`,
    )
  }

  // 4xx de claim = CONFIGURACAO, nao "fila vazia": rota inexistente (404 — ex.:
  // API_URL/versao da API errada), ou token invalido (401/403).
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new ClaimError(
      'config',
      `HTTP ${res.status} em ${API_URL}/api/internal/caixa-quitacao/claim — confira API_URL, se a rota existe nessa versao da API, e o INTERNAL_API_TOKEN.`,
    )
  }
  if (!res.ok) {
    throw new ClaimError('transient', `HTTP ${res.status}`)
  }

  const data = (await res.json()) as { job: Job | null }
  return data.job
}

async function reportResult(
  processId: string,
  result: string,
  message: string,
  pdf: { filename: string; bytes: Buffer } | null,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/internal/caixa-quitacao/result`, {
    method: 'POST',
    headers: { 'x-internal-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({
      processId,
      result,
      message,
      pdfBase64: pdf ? pdf.bytes.toString('base64') : null,
      pdfFilename: pdf?.filename ?? null,
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
    `[worker] iniciado. API=${API_URL} poll=${POLL_MS}ms interval=${MIN_INTERVAL_MS}ms`,
  )

  // Timestamp do inicio da ultima consulta — base do pacing global.
  let lastConsultaAt = 0
  // Sinal POSITIVO de boot: confirma no log que o worker alcancou a API (claim
  // OK) na primeira vez — "ausencia de erro" nao e confirmacao.
  let connectedLogged = false

  while (running) {
    let job: Job | null = null
    try {
      job = await claimJob()
    } catch (error) {
      // Config (404/401): erro de DEPLOY/configuracao — loga ALTO + backoff maior
      // (a 1a iteracao do loop ja funciona como probe de boot). Transitorio
      // (5xx/rede): loga e tenta de novo no ritmo normal.
      if (error instanceof ClaimError && error.kind === 'config') {
        console.error(
          `[worker] ERRO DE CONFIGURACAO no claim: ${error.message}`,
        )
        await sleep(CONFIG_ERROR_BACKOFF_MS)
        continue
      }
      console.error(
        `[worker] claim falhou (transitorio): ${(error as Error).message}`,
      )
      await sleep(POLL_MS)
      continue
    }

    if (!connectedLogged) {
      connectedLogged = true
      console.log(`[worker] conectado a API (${API_URL}) — claim OK.`)
    }

    if (!job) {
      await sleep(POLL_MS)
      continue
    }

    // Pacing GLOBAL: garante >= MIN_INTERVAL_MS desde o INICIO da consulta
    // anterior antes de bater no site de novo. So espera quando consultas saem
    // rapido demais (o que causaria throttling); se a anterior demorou, segue.
    const waitMs = lastConsultaAt + MIN_INTERVAL_MS - Date.now()
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    lastConsultaAt = Date.now()

    console.log(`[worker] consultando processo=${job.processId}`)
    // newContext/newPage DENTRO do try: um erro aqui (ou browser morto) nao deve
    // derrubar o loop inteiro — vira 'erro' daquele job. O browser e recriado se
    // tiver desconectado (crash/OOM em execucao de longa duracao).
    let ctx: Awaited<ReturnType<Browser['newContext']>> | null = null
    try {
      if (!browser.isConnected()) {
        console.warn('[worker] browser desconectado; relancando')
        browser = await chromium.launch({ headless: true })
      }
      ctx = await browser.newContext({
        acceptDownloads: true,
        userAgent: USER_AGENT,
      })
      const page = await ctx.newPage()
      const outcome = await consultarQuitacao(page, job.cpf)
      await reportResult(
        job.processId,
        outcome.result,
        outcome.message,
        outcome.pdf,
      )
      console.log(`[worker] processo=${job.processId} -> ${outcome.result}`)
    } catch (error) {
      console.error(
        `[worker] erro no processo=${job.processId}:`,
        (error as Error).message,
      )
      await reportResult(
        job.processId,
        'erro',
        (error as Error).message?.slice(0, 300) ?? 'erro inesperado',
        null,
      ).catch(() => {})
    } finally {
      if (ctx) {
        await ctx.close().catch(() => {})
      }
    }
  }

  await browser.close()
  console.log('[worker] encerrado')
  process.exit(0)
}

main().catch((error) => {
  console.error('[worker] fatal:', error)
  process.exit(1)
})
