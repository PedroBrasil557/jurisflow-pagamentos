import { processClaimedIngestion } from './modules/processes/processes.batch.service'
import { emitQueueMetrics } from './modules/processes/processes.ingestion.metrics'
import { claimNextIngestionJob } from './modules/processes/processes.ingestion.queue'
import { closeDb } from './shared/db'

// Worker dedicado da fila de ingestao (Fase 2). Processo separado da API (mesma
// imagem/codebase), deployado como container proprio com `bun run worker`. Isola o
// trabalho pesado (PDF/OpenCV/IA) do event-loop que atende requisicoes. Reivindica
// jobs do Postgres (claim+lease, FOR UPDATE SKIP LOCKED) e processa com heartbeat.
// Seguro com multiplas replicas.

const POLL_MS = Number(process.env.INGESTION_POLL_MS ?? '3000')
// Limite de concorrencia = backpressure real (o gargalo e o provider de IA:
// rate-limit/custo). Mantido baixo de proposito.
const CONCURRENCY = Number(process.env.INGESTION_CONCURRENCY ?? '2')
// Intervalo de emissao da metrica de fila (EMF). Desacoplado do POLL_MS: poll e
// curto (latencia de claim), metrica e ~1/min (evita volume desnecessario no log).
const METRICS_INTERVAL_MS = 60_000

let running = true
let lastMetricsAt = 0
const inFlight = new Set<Promise<void>>()

// Reivindica ate encher a concorrencia; cada job roda em paralelo ate o limite.
async function drainClaims(): Promise<void> {
  while (running && inFlight.size < CONCURRENCY) {
    const job = await claimNextIngestionJob()
    if (!job) {
      break
    }

    const work = processClaimedIngestion(job)
      .catch((error) => {
        // processClaimedIngestion ja trata internamente; isto e rede de seguranca.
        console.error('worker: job lancou inesperadamente', {
          batchFileId: job.batchFileId,
          error: String(error),
        })
      })
      .finally(() => {
        inFlight.delete(work)
      })
    inFlight.add(work)
  }
}

async function loop(): Promise<void> {
  console.log(
    `ingestion worker iniciado (poll=${POLL_MS}ms, concurrency=${CONCURRENCY})`,
  )

  while (running) {
    try {
      await drainClaims()
    } catch (error) {
      console.error('worker: erro ao reivindicar jobs', {
        error: String(error),
      })
    }

    // Emite a profundidade da fila ~1/min (throttle sobre o poll curto). Inclui
    // depth=0: o alarme precisa da metrica presente para distinguir fila-vazia
    // de worker-morto. Multi-replica emite o mesmo valor; o alarme usa Maximum.
    const now = Date.now()
    if (now - lastMetricsAt >= METRICS_INTERVAL_MS) {
      lastMetricsAt = now
      await emitQueueMetrics()
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

function shutdown(signal: string) {
  console.log(`ingestion worker: ${signal} recebido, encerrando (graceful)...`)
  running = false
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

await loop()
// Deixa os jobs em voo terminarem (gravam done/retry/dead-letter) antes de sair.
await Promise.allSettled([...inFlight])
// Encerra o pool de conexoes limpo (evita SIGKILL por handle aberto).
await closeDb()
console.log('ingestion worker: encerrado.')
