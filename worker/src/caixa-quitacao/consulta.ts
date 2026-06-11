import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import {
  type ConsultaQuitacaoResult,
  classifyConsultaQuitacao,
  INDISPONIVEL,
  NAO_ENCONTRADO,
} from './classify.ts'

export const CONSULTA_URL =
  'https://www.caixa.gov.br/voce/habitacao/minha-casa-minha-vida/faixa-I/consulta-MCMV/Paginas/default.aspx'

// Seletores verificados na pagina real (2026-06): a pagina e ASP.NET/SharePoint
// (a maioria dos controles tem id manglado ctl00$...), mas o widget da consulta
// usa estes IDs limpos e custom. Validados ao vivo: #cpf, #btnConsultar,
// #btnEmitirDeclaracao, #btnVoltar existem. Se mudarem, o sentinela D11 abaixo
// (campo CPF ausente) falha com mensagem clara.
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

// Captura EVIDENCIA deterministica do estado atual da pagina para diagnostico
// (caminhos de erro/indeterminados). Loga os marcadores que distinguem os
// estados — PII-safe (so booleans/contagens, nao o texto do resultado). O
// upload do screenshot vinculado ao processo (S3) fica como evolucao futura.
async function captureEvidence(page: Page, reason: string): Promise<void> {
  const emit = page.locator(SELECTORS.emitir)
  const markers = {
    reason,
    url: page.url(),
    emitVisible: await emit.isVisible().catch(() => false),
    emitEnabled: await emit.isEnabled().catch(() => false),
    voltarVisible: await page
      .locator(SELECTORS.voltar)
      .isVisible()
      .catch(() => false),
    hasNaoEncontrado: await page
      .getByText(NAO_ENCONTRADO)
      .count()
      .catch(() => 0),
    hasIndisponivel: await page.getByText(INDISPONIVEL).count().catch(() => 0),
  }
  console.error(
    `[consulta] evidencia ${JSON.stringify({ ts: new Date().toISOString(), ...markers })}`,
  )
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

  // PASSO 1: abre a pagina e espera DETERMINISTICAMENTE o campo CPF aparecer.
  await page.goto(CONSULTA_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  })
  await page
    .locator(SELECTORS.cpf)
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {})

  // D11: sentinela — se o campo CPF nao existe, a pagina nao e a esperada (site
  // alterado ou em manutencao). Falha com mensagem clara + evidencia.
  if ((await page.locator(SELECTORS.cpf).count()) === 0) {
    await captureEvidence(page, 'pagina_inesperada')
    return {
      result: 'erro',
      message:
        'Pagina inesperada da Caixa (estrutura alterada ou em manutencao): campo CPF nao encontrado.',
      pdf: null,
    }
  }

  // PASSO 2: preenche o CPF e submete.
  const cpfInput = page.locator(SELECTORS.cpf)
  await cpfInput.fill('')
  await cpfInput.pressSequentially(digits, { delay: 50 })
  await page.locator(SELECTORS.consultar).click({ timeout: 15_000 })

  // PASSO 3: espera um DESFECHO deterministico, correndo os sinais conhecidos
  // (mapeados ao vivo). O que vier PRIMEIRO decide:
  //  - #btnVoltar visivel       => o bloco "Resultado" carregou (quitado/nao-encontrado)
  //  - texto "indisponivel"     => site sobrecarregado ("tente mais tarde"): transitorio
  // Se nenhum aparecer no tempo, o resultado nao carregou (indeterminado).
  const RESULT_TIMEOUT = 30_000
  const settled = await Promise.race([
    page
      .locator(SELECTORS.voltar)
      .waitFor({ state: 'visible', timeout: RESULT_TIMEOUT })
      .then(() => 'loaded' as const)
      .catch(() => null),
    page
      .getByText(INDISPONIVEL)
      .first()
      .waitFor({ state: 'visible', timeout: RESULT_TIMEOUT })
      .then(() => 'indisponivel' as const)
      .catch(() => null),
  ])

  // Estado INDISPONIVEL: o site da Caixa pediu "tente mais tarde". Transitorio
  // (sera retentado pelo MAX_ATTEMPTS) — desfecho explicito, nao um erro opaco.
  if (settled === 'indisponivel') {
    await captureEvidence(page, 'indisponivel')
    return {
      result: 'erro',
      message:
        'Consulta indisponivel no site da Caixa no momento ("tente mais tarde"). Sera retentada.',
      pdf: null,
    }
  }

  // O resultado nao carregou no tempo (nem "Resultado", nem "indisponivel"):
  // indeterminado (site lento/instavel). Transitorio + evidencia.
  if (settled !== 'loaded') {
    await captureEvidence(page, 'resultado_nao_carregou')
    return {
      result: 'erro',
      message:
        'O resultado da consulta nao carregou a tempo (site lento/instavel). Sera retentada.',
      pdf: null,
    }
  }

  // PASSO 4: o bloco "Resultado" carregou (Voltar visivel). Pequena folga para o
  // botao Emitir terminar de habilitar, e classifica o desfecho ja estavel.
  await page.waitForTimeout(300)
  const emit = page.locator(SELECTORS.emitir)
  const emitButtonVisible = await emit.isVisible().catch(() => false)
  const emitButtonEnabled = await emit.isEnabled().catch(() => false)
  const resultMessage = await readResultMessage(page)

  const classified = classifyConsultaQuitacao({
    emitButtonEnabled,
    emitButtonVisible,
    resultMessage,
  })

  // Resultado carregou mas nao bate com quitado NEM nao-encontrado: estado
  // inesperado (estrutura da pagina pode ter mudado) — evidencia para diagnostico.
  if (classified.result === 'erro') {
    await captureEvidence(page, 'estado_inesperado')
    return {
      result: 'erro',
      message:
        'Resultado da consulta em estado inesperado (a estrutura da pagina pode ter mudado).',
      pdf: null,
    }
  }

  if (classified.result === 'nao_encontrado') {
    return { result: 'nao_encontrado', message: classified.message, pdf: null }
  }

  // PASSO 5: quitado => emitir => download direto do PDF da Declaracao de Quitacao.
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
