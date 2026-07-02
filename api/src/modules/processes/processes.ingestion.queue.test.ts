import { describe, expect, test } from 'bun:test'
import {
  computeBackoffMs,
  INGESTION_HEARTBEAT_MS,
  INGESTION_LEASE_TTL_MS,
  INGESTION_MAX_DELIVERIES,
  INGESTION_MAX_FAILURES,
} from './processes.ingestion.queue'

describe('computeBackoffMs', () => {
  test('cresce exponencialmente a partir da 1a tentativa', () => {
    // base 30s * 3^(attempts-1)
    expect(computeBackoffMs(1)).toBe(30_000)
    expect(computeBackoffMs(2)).toBe(90_000)
    expect(computeBackoffMs(3)).toBe(270_000)
  })

  test('respeita o teto', () => {
    // 30s * 3^4 = 2.43M ms -> limitado a 10min
    expect(computeBackoffMs(5)).toBe(10 * 60 * 1000)
    expect(computeBackoffMs(50)).toBe(10 * 60 * 1000)
  })

  test('nunca negativo nem abaixo da base para entradas degeneradas', () => {
    expect(computeBackoffMs(0)).toBe(30_000)
    expect(computeBackoffMs(-3)).toBe(30_000)
  })
})

describe('constantes da fila', () => {
  test('heartbeat e ~1/3 do lease (margem para jitter)', () => {
    expect(INGESTION_HEARTBEAT_MS).toBe(Math.floor(INGESTION_LEASE_TTL_MS / 3))
    expect(INGESTION_HEARTBEAT_MS).toBeLessThan(INGESTION_LEASE_TTL_MS)
  })

  test('max de falhas e finito e > 1', () => {
    expect(INGESTION_MAX_FAILURES).toBeGreaterThan(1)
    expect(Number.isFinite(INGESTION_MAX_FAILURES)).toBe(true)
  })

  test('backstop de entregas e maior que o orcamento de falhas', () => {
    // O backstop precisa folgar acima do orcamento de retry para tolerar churn de
    // infra (re-entregas por crash/orfao) sem dead-letar um job inocente cedo.
    expect(INGESTION_MAX_DELIVERIES).toBeGreaterThan(INGESTION_MAX_FAILURES)
  })
})
