// Espacador GLOBAL de INICIOS de consulta ao portal da Caixa. Serializa as chamadas
// acquire() para que os inicios fiquem >= minInterval apart (com jitter +-ratio para
// nao parecer robotico). E compartilhado por TODOS os slots do pool concorrente:
// e o UNICO ponto que governa a taxa de requisicoes ao portal, independente da
// concorrencia. Portanto vazao = min(1/minInterval, concorrencia/latencia).
//
// Sem AIMD de proposito: o backoff por-job ja vive no banco (a fila re-tenta cada
// consulta transitoria com backoff exponencial), e um AIMD em memoria resetaria ao
// piso a cada deploy/restart — martelando a Caixa logo apos o boot. Aqui o intervalo
// e FIXO (vindo do env); ops ajusta por env se precisar afrouxar.

export type GlobalSpacerOptions = {
  // Intervalo minimo entre inicios. Pode ser um NUMERO fixo ou um PROVIDER
  // resolvido a cada acquire() — assim o freio (breaker) e o piso travado variam
  // a taxa em tempo real sem recriar o espacador.
  minIntervalMs: number | (() => number)
  // Fracao do intervalo aplicada como jitter simetrico (+- ratio). Default 0.2.
  jitterRatio?: number
  // Injetaveis para teste deterministico (default: relogio/aleatorio reais).
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export class GlobalSpacer {
  private readonly resolveInterval: () => number
  private readonly jitterRatio: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  // Momento mais cedo em que o PROXIMO inicio e permitido.
  private nextAllowedAt = 0
  // Cadeia que serializa os acquire() concorrentes: cada um espera o anterior
  // liberar antes de ler/gravar nextAllowedAt e dormir — sem isso, N slots leriam
  // o mesmo nextAllowedAt e disparariam em rajada.
  private tail: Promise<void> = Promise.resolve()

  constructor(opts: GlobalSpacerOptions) {
    const mi = opts.minIntervalMs
    this.resolveInterval =
      typeof mi === 'function' ? () => Math.max(0, mi()) : () => Math.max(0, mi)
    this.jitterRatio = opts.jitterRatio ?? 0.2
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? realSleep
    this.random = opts.random ?? Math.random
  }

  // Resolve quando este slot esta autorizado a INICIAR uma consulta, respeitando o
  // espacamento global. O primeiro acquire retorna de imediato; os seguintes se
  // espalham >= minInterval (com jitter) apos o inicio anterior. O intervalo e
  // resolvido POR chamada (provider), entao o freio ajusta a taxa em tempo real.
  async acquire(): Promise<void> {
    const prev = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await prev
    try {
      const interval = this.resolveInterval()
      const wait = this.nextAllowedAt - this.now()
      if (wait > 0) {
        await this.sleep(wait)
      }
      const jitter = interval * this.jitterRatio * (this.random() * 2 - 1)
      this.nextAllowedAt = this.now() + Math.max(0, interval + jitter)
    } finally {
      release()
    }
  }
}
