import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from 'playwright'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Hosts de analytics/tracking abortados quando BLOCK_RESOURCES esta ligado: nao
// participam da logica da consulta e so somam requisicoes ao carregar a pagina.
const ANALYTICS_DENYLIST = [
  'google-analytics',
  'googletagmanager',
  'doubleclick',
  'hotjar',
  'connect.facebook',
  'clarity.ms',
]

// Instala o roteador que ABORTA imagens/media/fontes + analytics e DEIXA PASSAR
// document/script/stylesheet/xhr/fetch/websocket. Motivos de manter css/js: o
// #btnConsultar habilita via JS e o isVisible/isEnabled do Playwright depende de
// render; o postback do "Emitir" e navigation/xhr — nenhum e bloqueado. Beneficio:
// menos requisicoes ao portal por consulta (cortesia) + menos memoria por contexto.
async function installResourceBlocking(ctx: BrowserContext): Promise<void> {
  await ctx.route('**/*', async (route) => {
    try {
      const req = route.request()
      const type = req.resourceType()
      if (type === 'image' || type === 'media' || type === 'font') {
        await route.abort()
        return
      }
      const url = req.url()
      if (ANALYTICS_DENYLIST.some((host) => url.includes(host))) {
        await route.abort()
        return
      }
      await route.continue()
    } catch {
      // A rota pode ja ter sido resolvida (contexto fechando): ignore.
    }
  })
}

export type BrowserHolderOptions = {
  // Aborta recursos nao-essenciais por consulta (default false = comportamento antigo).
  blockResources?: boolean
}

// Detentor do browser Playwright compartilhado pelo pool. Um unico browser serve
// TODOS os slots; cada consulta roda num CONTEXTO novo (isolamento de cookies/estado
// entre CPFs). O relanamento e serializado sob lock: se N slots detectarem o browser
// desconectado ao mesmo tempo, apenas UM relanca (os demais aguardam o mesmo launch).
export class BrowserHolder {
  private browser: Browser | null = null
  private launching: Promise<Browser> | null = null
  private readonly blockResources: boolean

  constructor(opts: BrowserHolderOptions = {}) {
    this.blockResources = opts.blockResources ?? false
  }

  private async get(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser
    }
    if (!this.launching) {
      // Args de estabilidade em container com muitos contextos concorrentes:
      // --disable-dev-shm-usage evita OOM do /dev/shm limitado do Fargate.
      this.launching = chromium
        .launch({
          headless: true,
          args: ['--disable-dev-shm-usage', '--disable-gpu'],
        })
        .then(
          (b) => {
            this.browser = b
            this.launching = null
            return b
          },
          (err) => {
            this.launching = null
            throw err
          },
        )
    }
    return this.launching
  }

  // Executa fn com um contexto/page novos e SEMPRE fecha o contexto ao final
  // (mesmo em erro). O ciclo de vida do browser fica com o holder.
  async withContext<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.get()
    const ctx = await browser.newContext({
      acceptDownloads: true,
      userAgent: USER_AGENT,
    })
    try {
      if (this.blockResources) {
        await installResourceBlocking(ctx)
      }
      const page = await ctx.newPage()
      return await fn(page)
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  async close(): Promise<void> {
    const b = this.browser
    this.browser = null
    if (b) {
      await b.close().catch(() => {})
    }
  }
}
