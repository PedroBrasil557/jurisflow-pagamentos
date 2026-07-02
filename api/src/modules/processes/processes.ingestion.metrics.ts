import { sql } from 'drizzle-orm'
import { db } from '../../shared/db'

// Observabilidade da fila de ingestao (Fase 3). O worker mede a profundidade da
// fila e emite via EMF (Embedded Metric Format): um console.log de JSON que o
// CloudWatch Logs extrai como metrica automaticamente — SEM SDK, SEM permissao
// PutMetricData, SEM chamada de rede. A metrica dirige o autoscaling (escala pela
// fila, nao por CPU — o worker fica ocioso em CPU esperando a IA) e um alarme
// (fila travada / todos os workers mortos => metrica some => alarme breaching).

export type QueueDepthSnapshot = {
  // Jobs prontos para reivindicar AGORA (mesmo predicado do claim): 'queued'
  // elegivel (sem backoff pendente) + 'processing' orfao (lease expirado).
  depth: number
  // Ha quanto tempo (s) o job elegivel mais antigo espera. Cresce quando os
  // workers nao drenam — sinal de fila travada.
  oldestAgeSeconds: number
}

// Mesmo predicado de elegibilidade do claimNextIngestionJob: medimos exatamente o
// backlog que precisa de um worker (exclui 'queued' ainda em backoff e jobs sob
// lease vivo de outro worker).
export async function measureQueueDepth(): Promise<QueueDepthSnapshot> {
  const result = await db.execute(sql`
    SELECT
      count(*)::int AS depth,
      COALESCE(
        EXTRACT(EPOCH FROM (now() - min(split_updated_at)))::int,
        0
      ) AS oldest_age_seconds
    FROM process_batch_file
    WHERE (
        split_status = 'queued'
        AND (split_lease_expires_at IS NULL OR split_lease_expires_at < now())
      )
      OR (split_status = 'processing' AND split_lease_expires_at < now())
  `)

  const row = (result as unknown as { rows: Array<Record<string, unknown>> })
    .rows[0]

  return {
    depth: Number(row?.depth ?? 0),
    oldestAgeSeconds: Number(row?.oldest_age_seconds ?? 0),
  }
}

const METRICS_NAMESPACE = 'Jurisflow/Ingestion'

// Mede e emite (EMF) a profundidade da fila. No-op fora do ambiente cloud (sem
// ENVIRONMENT nao ha CloudWatch para extrair o EMF — emitir so poluiria o log
// local). Emite SEMPRE que no cloud, inclusive depth=0: o alarme precisa ver a
// metrica "presente e saudavel" para distinguir fila-vazia de worker-morto.
export async function emitQueueMetrics(): Promise<void> {
  const environment = process.env.ENVIRONMENT
  if (!environment) {
    return
  }

  try {
    const { depth, oldestAgeSeconds } = await measureQueueDepth()

    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: METRICS_NAMESPACE,
              Dimensions: [['Environment']],
              Metrics: [
                { Name: 'QueueDepth', Unit: 'Count' },
                { Name: 'OldestQueuedAgeSeconds', Unit: 'Seconds' },
              ],
            },
          ],
        },
        Environment: environment,
        QueueDepth: depth,
        OldestQueuedAgeSeconds: oldestAgeSeconds,
      }),
    )
  } catch (error) {
    // Nunca derruba o loop do worker por causa de telemetria.
    console.error('ingestion: falha ao medir/emitir metrica de fila', {
      error: String(error),
    })
  }
}
