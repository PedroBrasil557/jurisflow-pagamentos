import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GlobalSpacer } from './rate-limiter.ts'

// Relogio virtual: sleep AVANCA o tempo (sincrono), entao os testes sao
// deterministicos e instantaneos, sem timers reais.
function fakeClock(start = 1000) {
  let t = start
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms
      return Promise.resolve()
    },
  }
}

test('espaca inicios sequenciais em >= minInterval (jitter zero)', async () => {
  const { now, sleep } = fakeClock()
  const spacer = new GlobalSpacer({
    minIntervalMs: 5000,
    now,
    sleep,
    random: () => 0.5, // (0.5*2-1)=0 => jitter zero
  })

  const starts: number[] = []
  for (let i = 0; i < 4; i++) {
    await spacer.acquire()
    starts.push(now())
  }

  assert.deepEqual(starts, [1000, 6000, 11000, 16000])
})

test('acquire concorrente nao dispara em rajada: serializa e espaca', async () => {
  const { now, sleep } = fakeClock()
  const spacer = new GlobalSpacer({
    minIntervalMs: 5000,
    now,
    sleep,
    random: () => 0.5,
  })

  // Dispara 5 acquire() "ao mesmo tempo" (como 5 slots do pool). Se NAO serializasse,
  // todos leriam nextAllowedAt=0, nenhum dormiria e o relogio final ficaria em 1000
  // (rajada). Serializado, 4 esperas de 5000 avancam o relogio ate 21000.
  const n = 5
  let done = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      await spacer.acquire()
      done++
    }),
  )

  assert.equal(done, n)
  assert.equal(now(), 1000 + (n - 1) * 5000)
})

test('jitter mantem o espacamento dentro de [min*(1-ratio), min*(1+ratio)]', async () => {
  const { now, sleep } = fakeClock()
  // random alterna 0 e 1 => jitter -ratio e +ratio nos extremos.
  let flip = 0
  const spacer = new GlobalSpacer({
    minIntervalMs: 10_000,
    jitterRatio: 0.2,
    now,
    sleep,
    random: () => (flip++ % 2 === 0 ? 0 : 1),
  })

  const starts: number[] = []
  for (let i = 0; i < 6; i++) {
    await spacer.acquire()
    starts.push(now())
  }

  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1]
    assert.ok(
      gap >= 8000 && gap <= 12000,
      `gap ${gap} fora de [8000, 12000] no passo ${i}`,
    )
  }
})
