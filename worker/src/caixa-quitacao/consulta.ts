import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import {
  type ConsultaQuitacaoResult,
  classifyConsultaQuitacao,
  NAO_ENCONTRADO,
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
  // D9: valida o CPF antes de consultar — o claim confia no cpf do banco, que
  // pode ter sido editado para algo invalido apos o enqueue. Nao submeter lixo
  // (poderia retornar dados de outro contrato).
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
    return {
      result: 'erro',
      message: `CPF invalido para consulta (${digits.length} digito(s)).`,
      pdf: null,
    }
  }

  await page.goto(CONSULTA_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  })
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {})

  // D11: sentinela — se o campo CPF nao existe, a pagina nao e a esperada (site
  // alterado ou em manutencao). Falha com mensagem clara, nao um timeout opaco.
  if ((await page.locator(SELECTORS.cpf).count()) === 0) {
    return {
      result: 'erro',
      message:
        'Pagina inesperada da Caixa (estrutura alterada ou em manutencao): campo CPF nao encontrado.',
      pdf: null,
    }
  }

  const cpfInput = page.locator(SELECTORS.cpf)
  await cpfInput.fill('')
  await cpfInput.pressSequentially(digits, { delay: 50 })

  await page.locator(SELECTORS.consultar).click({ timeout: 15_000 })
  await page
    .waitForLoadState('networkidle', { timeout: 30_000 })
    .catch(() => {})

  const emit = page.locator(SELECTORS.emitir)
  // Em vez de um sleep fixo (fragil sob postback ASP.NET lento), espera por um
  // estado DEFINITIVO: botao "Emitir" habilitado+visivel (quitado) OU a mensagem
  // de "nao encontrado". Se estourar o timeout, le o estado atual mesmo assim.
  await Promise.race([
    emit.waitFor({ state: 'visible', timeout: 15_000 }),
    page.getByText(NAO_ENCONTRADO).first().waitFor({ timeout: 15_000 }),
  ]).catch(() => {})
  // pequena folga para o botao terminar de habilitar apos ficar visivel
  await page.waitForTimeout(500)

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

  // Quitado confirmado, mas o PDF veio vazio/falhou: trata como 'erro'
  // (reprocessavel) em vez de anexar uma declaracao em branco como sucesso.
  if (bytes.length === 0) {
    return {
      result: 'erro',
      message:
        'Contrato quitado, mas o download da declaracao falhou (PDF vazio).',
      pdf: null,
    }
  }

  return {
    result: 'quitado',
    message: classified.message,
    pdf: { filename: download.suggestedFilename(), bytes },
  }
}
