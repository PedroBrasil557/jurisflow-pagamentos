import { type Browser, chromium, type Page } from 'playwright'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Detentor do browser Playwright compartilhado pelo pool. Um unico browser serve
// TODOS os slots; cada consulta roda num CONTEXTO novo (isolamento de cookies/estado
// entre CPFs). O relanamento e serializado sob lock: se N slots detectarem o browser
// desconectado ao mesmo tempo, apenas UM relanca (os demais aguardam o mesmo launch).
export class BrowserHolder {
  private browser: Browser | null = null
  private launching: Promise<Browser> | null = null

  private async get(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser
    }
    if (!this.launching) {
      this.launching = chromium.launch({ headless: true }).then(
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
