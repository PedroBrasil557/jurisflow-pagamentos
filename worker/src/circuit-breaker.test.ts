import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PortalBreaker } from './circuit-breaker.ts'

// Relogio virtual mutavel: os testes controlam o avanco do tempo (o breaker le
// this.now() em cada record/consulta). Determinismo sem timers reais.
function clock(start = 1000) {
  const c = { t: start }
  return { c, now: () => c.t }
}

const FLOOR = 2400 // degrau 2 (default do piso travado)

test('closed por padrao: fator 1, sem pausa, sem piso', () => {
  const { now } = clock()
  const b = new PortalBreaker({ now })
  assert.equal(b.intervalFactor(), 1)
  assert.equal(b.pausedUntilMs(), 0)
  assert.equal(b.floorIntervalMs(), 0)
})

test('>= 30% de estresse na janela (>=10 amostras) entra em slow, sem travar piso', () => {
  const { now } = clock()
  const b = new PortalBreaker({ now })
  // 7 ok + 3 stress (max 3 consecutivos < 5) => ratio 0.3 => slow (nao pausa).
  for (let i = 0; i < 7; i++) b.record('ok')
  for (let i = 0; i < 3; i++) b.record('stress')
  assert.equal(b.intervalFactor(), 2, 'deve estar em slow (fator 2)')
  assert.equal(b.pausedUntilMs(), 0, 'slow nao pausa')
  assert.equal(b.floorIntervalMs(), 0, 'slow sozinho nao trava o piso')
})

test('>= 60% de estresse na janela pausa e trava o piso (via ratio, sem streak)', () => {
  const { now } = clock()
  const b = new PortalBreaker({ now })
  // 6 stress / 10, com no maximo 4 consecutivos (isola o caminho por ratio).
  const seq = [
    'stress',
    'stress',
    'stress',
    'stress',
    'ok',
    'stress',
    'stress',
    'ok',
    'ok',
    'ok',
  ] as const
  for (const s of seq) b.record(s)
  assert.ok(b.pausedUntilMs() > now(), 'deve estar pausado')
  assert.equal(b.floorIntervalMs(), FLOOR, 'pausa trava o piso em degrau 2')
})

test('5 estresses consecutivos pausam mesmo com < 10 amostras', () => {
  const { now } = clock()
  const b = new PortalBreaker({ now })
  for (let i = 0; i < 5; i++) b.record('stress')
  assert.ok(b.pausedUntilMs() > now())
  assert.equal(b.floorIntervalMs(), FLOOR)
})

test('um unico sentinel TRAVA o piso imediatamente sem pausar', () => {
  const { now } = clock()
  const b = new PortalBreaker({ now })
  b.record('sentinel')
  assert.equal(b.floorIntervalMs(), FLOOR, 'sentinel trava o piso na hora')
  assert.equal(b.pausedUntilMs(), 0, '1 sentinel nao pausa (precisa de 2)')
  assert.equal(b.intervalFactor(), 1, 'sem slow ainda; so o piso segura a taxa')
})

test('2 sentinels consecutivos pausam', () => {
  const { now } = clock()
  const b = new PortalBreaker({ now })
  b.record('sentinel')
  b.record('sentinel')
  assert.ok(b.pausedUntilMs() > now())
  assert.equal(b.floorIntervalMs(), FLOOR)
})

test('piso travado NAO destrava sozinho apos o cooldown (retomar exige humano)', () => {
  const { c, now } = clock()
  const b = new PortalBreaker({ now })
  for (let i = 0; i < 5; i++) b.record('stress') // pausa + trava
  assert.equal(b.floorIntervalMs(), FLOOR)
  // Avanca o relogio muito alem de qualquer cooldown (2h).
  c.t += 2 * 60 * 60_000
  assert.equal(b.pausedUntilMs(), 0, 'pausa expira')
  assert.equal(b.intervalFactor(), 1, 'volta de slow p/ closed')
  assert.equal(
    b.floorIntervalMs(),
    FLOOR,
    'mas o piso continua travado — nao retorna ao alvo sozinho',
  )
})

test('histerese: re-trip dentro de 30min dobra o cooldown', () => {
  const { c, now } = clock()
  const b = new PortalBreaker({ now })
  for (let i = 0; i < 5; i++) b.record('stress')
  const firstCooldown = b.pausedUntilMs() - now() // 15min
  assert.equal(firstCooldown, 15 * 60_000)
  // 1s depois (dentro de HEALTHY_RESET de 30min), dispara de novo.
  c.t += 1000
  for (let i = 0; i < 5; i++) b.record('stress')
  const secondCooldown = b.pausedUntilMs() - now()
  assert.equal(secondCooldown, 30 * 60_000, 'cooldown dobrou (15 -> 30min)')
})
