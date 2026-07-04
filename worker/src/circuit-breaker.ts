// Freio de seguranca do portal da Caixa: um circuit breaker que SO DESACELERA.
// Ao contrario de um AIMD (rejeitado no rate-limiter), este nunca acelera alem da
// politica configurada — apenas freia ACIMA dela quando o portal da sinais de
// estresse, e alerta. Por isso o estado em memoria e seguro: no reboot, o pior
// caso e voltar a taxa ja considerada educada; a janela deslizante re-enche em
// ~1-2min e o freio re-dispara se o portal ainda estiver ruim.
//
// Assimetria de projeto (regra de ouro): DESACELERAR e automatico (aqui); ACELERAR
// e sempre decisao humana (subir o degrau = baixar a env do intervalo).
//
// Consome um sinal por consulta:
//   - 'ok'       -> desfecho valido (quitado / nao_encontrado)
//   - 'stress'   -> portal reclamando (indisponivel, resultado nao carregou, botao
//                   nao habilitou = JS lento sob carga, etc.)
//   - 'sentinel' -> pagina inesperada (sem campo CPF). E FREQUENTE na base deste
//     portal (~2% das consultas, medido em prod), entao conta como 'stress' comum e
//     so escala o piso quando AGRUPA (>=3 seguidas ou >=4 na janela = assinatura de
//     bloqueio/captcha) — NAO trava na primeira ocorrencia isolada.

export type BreakerSignal = 'ok' | 'stress' | 'sentinel'

export type PortalBreakerOptions = {
  // Injetavel para teste deterministico (default: relogio real).
  now?: () => number
  // Piso travado (default degrau 2 = 2400ms ~= 1.500/h). So e travado quando o
  // breaker PAUSA (sobrecarga/bloqueio reais), nunca por uma sentinela isolada.
  floorIntervalMs?: number
}

// Janela deslizante e limiares — CONSTANTES no codigo (menos superficie de erro;
// mudar exige deploy, adequado a criticidade).
const WINDOW = 20
const MIN_SAMPLES = 10
const SLOW_PCT = 0.3
const PAUSE_PCT = 0.6
const STRESS_STREAK = 5 // consecutivos -> pausa (generaliza "5 indisponivel")
// pagina_inesperada e evento de BASE frequente deste portal (~2,3% das consultas,
// medido em prod), entao NAO trava na primeira: so escala quando AGRUPA (assinatura
// de captcha/bloqueio, nao ruido). Limiares bem acima do baseline.
const SENTINEL_STREAK = 3 // sentinelas consecutivas -> pausa (~1 em 80k por acaso)
const SENTINEL_WINDOW = 4 // sentinelas na janela de 20 (~8x o baseline) -> pausa
const SLOW_COOLDOWN_MS = 10 * 60_000
const PAUSE_COOLDOWN_MS = 15 * 60_000
const COOLDOWN_CAP_MS = 60 * 60_000
const HEALTHY_RESET_MS = 30 * 60_000
const DEFAULT_FLOOR_MS = 2400

export class PortalBreaker {
  private readonly now: () => number
  private readonly floorMs: number
  private ring: BreakerSignal[] = []
  private consecutiveStress = 0
  private consecutiveSentinel = 0
  private pausedUntil = 0
  private slowUntil = 0
  private latched = false
  private lastTripAt = Number.NEGATIVE_INFINITY
  private pauseMultiplier = 1

  constructor(opts: PortalBreakerOptions = {}) {
    this.now = opts.now ?? Date.now
    this.floorMs = opts.floorIntervalMs ?? DEFAULT_FLOOR_MS
  }

  // Fator multiplicativo do intervalo do espacador: 2 em slow/paused, 1 em closed.
  intervalFactor(): number {
    return this.now() < this.slowUntil ? 2 : 1
  }

  // Momento (ms) ate o qual NENHUM claim novo deve ser feito. 0 = nao pausado.
  // O caller checa isto ANTES do claim (nunca com job em maos: pausar segurando
  // um job estouraria o lease e permitiria re-claim duplicado).
  pausedUntilMs(): number {
    return this.now() < this.pausedUntil ? this.pausedUntil : 0
  }

  // Piso de intervalo travado: 0 normalmente; floorMs (degrau 2) apos uma PAUSA
  // (sobrecarga/bloqueio reais). NUNCA destrava sozinho — retomar exige acao humana.
  floorIntervalMs(): number {
    return this.latched ? this.floorMs : 0
  }

  private stressInWindow(): number {
    let n = 0
    for (const s of this.ring) {
      if (s !== 'ok') n++
    }
    return n
  }

  private sentinelInWindow(): number {
    let n = 0
    for (const s of this.ring) {
      if (s === 'sentinel') n++
    }
    return n
  }

  private resetWindow(): void {
    this.ring = []
    this.consecutiveStress = 0
    this.consecutiveSentinel = 0
  }

  // Registra o desfecho de UMA consulta. So ESCALA (nunca acelera): timers seguram
  // o estado ate expirarem; a recuperacao a 'closed' e implicita quando slowUntil
  // passa sem novo gatilho.
  record(signal: BreakerSignal): void {
    const now = this.now()
    this.ring.push(signal)
    if (this.ring.length > WINDOW) {
      this.ring.shift()
    }

    if (signal === 'ok') {
      this.consecutiveStress = 0
      this.consecutiveSentinel = 0
    } else if (signal === 'stress') {
      this.consecutiveStress++
      this.consecutiveSentinel = 0
    } else {
      // sentinel: pagina inesperada. Conta como stress (no % e no streak de stress)
      // e alimenta os contadores especificos de sentinela — mas NAO trava sozinha.
      this.consecutiveStress++
      this.consecutiveSentinel++
    }

    const samples = this.ring.length
    const ratio = samples > 0 ? this.stressInWindow() / samples : 0

    // Motivo do pause (o 1o que casar) — o piso so trava por um destes sinais REAIS.
    let pauseReason: string | null = null
    if (samples >= MIN_SAMPLES && ratio >= PAUSE_PCT) {
      pauseReason = 'stress_pct'
    } else if (this.consecutiveStress >= STRESS_STREAK) {
      pauseReason = 'stress_streak'
    } else if (this.consecutiveSentinel >= SENTINEL_STREAK) {
      pauseReason = 'sentinel_streak'
    } else if (this.sentinelInWindow() >= SENTINEL_WINDOW) {
      pauseReason = 'sentinel_burst'
    }
    const shouldSlow = samples >= MIN_SAMPLES && ratio >= SLOW_PCT

    if (pauseReason) {
      this.enterPaused(now, pauseReason)
    } else if (shouldSlow && now >= this.slowUntil) {
      this.enterSlow(now)
    }
  }

  private enterPaused(now: number, reason: string): void {
    // Histerese: re-trip dentro de HEALTHY_RESET dobra o cooldown (teto = CAP);
    // 30min saudavel zera o multiplicador.
    this.pauseMultiplier =
      now - this.lastTripAt <= HEALTHY_RESET_MS
        ? Math.min(
            this.pauseMultiplier * 2,
            COOLDOWN_CAP_MS / PAUSE_COOLDOWN_MS,
          )
        : 1
    const cooldown = Math.min(
      PAUSE_COOLDOWN_MS * this.pauseMultiplier,
      COOLDOWN_CAP_MS,
    )
    this.pausedUntil = now + cooldown
    // Histerese paused->slow: ao expirar a pausa, segue em slow por SLOW_COOLDOWN.
    this.slowUntil = this.pausedUntil + SLOW_COOLDOWN_MS
    if (!this.latched) {
      this.latched = true
    }
    this.lastTripAt = now
    this.resetWindow()
    this.log(
      'paused',
      `motivo=${reason} cooldown=${Math.round(cooldown / 1000)}s`,
    )
  }

  private enterSlow(now: number): void {
    this.slowUntil = now + SLOW_COOLDOWN_MS
    this.lastTripAt = now
    this.log('slow', '')
  }

  private log(state: string, detail: string): void {
    console.error(
      `[breaker] ${state}${detail ? ` ${detail}` : ''} ${JSON.stringify({
        ts: new Date().toISOString(),
        latched: this.latched,
        floorMs: this.floorIntervalMs(),
      })}`,
    )
  }
}
