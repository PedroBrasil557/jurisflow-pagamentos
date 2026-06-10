import { type Browser, chromium } from 'playwright'
import { consultarQuitacao } from './caixa-quitacao/consulta.ts'

const API_URL = process.env.API_URL ?? 'http://localhost:3556'
const TOKEN = process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token-change-me'
// Fallback robusto: um POLL_MS invalido (ex.: "5s") nao pode virar NaN ->
// setTimeout(NaN)=0 -> busy-loop martelando o /claim.
const parsedPoll = Number(process.env.POLL_MS)
const POLL_MS =
  Number.isFinite(parsedPoll) && parsedPoll > 0 ? parsedPoll : 5000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

type Job = { processId: string; cpf: string }

async function claimJob(): Promise<Job | null> {
  const res = await fetch(`${API_URL}/api/internal/caixa-quitacao/claim`, {
    method: 'POST',
    headers: { 'x-internal-token': TOKEN },
  })
  if (!res.ok) {
    throw new Error(`claim HTTP ${res.status}`)
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
  console.log(`[worker] iniciado. API=${API_URL} poll=${POLL_MS}ms`)

  while (running) {
    let job: Job | null = null
    try {
      job = await claimJob()
    } catch (error) {
      console.error('[worker] claim falhou:', (error as Error).message)
      await sleep(POLL_MS)
      continue
    }

    if (!job) {
      await sleep(POLL_MS)
      continue
    }

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
