import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import {
  type ConsultaQuitacaoResult,
  classifyConsultaQuitacao,
} from './classify.ts'

export const CONSULTA_URL =
  'https://www.caixa.gov.br/voce/habitacao/minha-casa-minha-vida/faixa-I/consulta-MCMV/Paginas/default.aspx'

// Seletores descobertos no spike (estaveis: ids fixos do ASP.NET).
const SELECTORS = {
  cpf: '#cpf',
  consultar: '#btnConsultar',
  emitir: '#btnEmitirDeclaracao',
  voltar: '#btnVoltar',
} as const

export type ConsultaQuitacaoOutcome = {
  result: ConsultaQuitacaoResult
  message: string
  pdf: { filename: string; bytes: Buffer } | null
}

// Le a mensagem do bloco "Resultado" (o container que envolve os botoes
// Voltar/Emitir). Robustez: se nao encontrar, retorna ''. A decisao usa o
// estado do botao como sinal primario, entao a mensagem e secundaria.
async function readResultMessage(page: Page): Promise<string> {
  // O bloco "Resultado" e o ancestral div.form-set do botao; contem a mensagem
  // ("Parabens..." ou "...nao foi encontrado contrato...") + os botoes. Removemos
  // os rotulos dos botoes e o zero-width space inicial do ASP.NET.
  const block = page
    .locator(SELECTORS.emitir)
    .locator('xpath=ancestor::div[contains(@class,"form-set")][1]')
    .first()
  const raw = await block.innerText({ timeout: 5000 }).catch(() => '')
  return raw
    .replace(/\bVoltar\b/gi, '')
    .replace(/Emitir\s+declara[çc][ãa]o/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Executa a consulta de quitacao para um CPF. NAO lanca em fluxo normal: erros
// inesperados viram result 'erro'. Recebe uma Page ja criada (o worker controla
// o ciclo de vida do browser/contexto).
export async function consultarQuitacao(
  page: Page,
  cpf: string,
): Promise<ConsultaQuitacaoOutcome> {
  await page.goto(CONSULTA_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  })
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {})

  const cpfInput = page.locator(SELECTORS.cpf)
  await cpfInput.fill('')
  await cpfInput.pressSequentially(cpf.replace(/\D/g, ''), { delay: 50 })

  await page.locator(SELECTORS.consultar).click({ timeout: 15_000 })
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {})
  await page.waitForTimeout(2_000)

  const emit = page.locator(SELECTORS.emitir)
  const emitButtonVisible = await emit.isVisible().catch(() => false)
  const emitButtonEnabled = await emit.isEnabled().catch(() => false)
  const resultMessage = await readResultMessage(page)

  const classified = classifyConsultaQuitacao({
    emitButtonEnabled,
    emitButtonVisible,
    resultMessage,
  })

  if (classified.result !== 'quitado') {
    return { result: classified.result, message: classified.message, pdf: null }
  }

  // Quitado: emitir => download direto do PDF da Declaracao de Quitacao.
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await emit.click()
  const download = await downloadPromise
  const path = await download.path()
  const bytes = path ? await readFile(path) : Buffer.alloc(0)

  return {
    result: 'quitado',
    message: classified.message,
    pdf: { filename: download.suggestedFilename(), bytes },
  }
}
