import { isValidCpf, normalizeCpf } from '../../shared/utils/cpf'
import { normalizeName } from '../../shared/utils/name'

// Comprador extraido de um termo da Caixa (entrega/quitacao). O LLM SO extrai —
// nao julga. `cpf` e null quando o documento nao traz o CPF do comprador.
export type CaixaBuyer = {
  nome: string
  cpf: string | null
  trechoFonte?: string
  origem?: 'lido' | 'inferido'
}

export type CaixaTitular = {
  fullName: string
  cpf: string
}

export type CaixaOwnerMatch = 'cpf' | 'name' | 'none'

export type CaixaOwnerResult = {
  // A eleicao do ownerType compara o titular do PROCESSO com as pessoas do TERMO,
  // em duas camadas (titular e conjuge). Quatro desfechos:
  // - 'titular'         => bate com o titular do termo (titular do contrato Caixa).
  // - 'conjuge_titular' => bate com o conjuge (co-assinante) do termo. Tambem
  //   adquiriu pelo contrato Caixa original, entao NAO exige contrato_compra_venda
  //   (mesmo tratamento documental do titular).
  // - 'nao_titular'     => diferenca CONFIRMADA (nao bate nem com titular nem com
  //   conjuge, com CPF confirmando). Comprou de terceiro => exige compra e venda.
  // - 'review'          => INDETERMINADO (nao da pra afirmar igualdade nem diferenca).
  result: 'titular' | 'conjuge_titular' | 'nao_titular' | 'review'
  matchedBy: CaixaOwnerMatch
}

// Decisao DETERMINISTICA (codigo, nunca o LLM). Precisao sobre recall:
// 1) CPF e o sinal primario — exige ambos validos (checksum) e iguais.
// 2) Nome so e usado como fallback QUANDO a pessoa NAO TRAZ CPF no doc. Se o doc
//    traz um CPF (mesmo mascarado/parcial, ex.: "111.444.***-**" — comum por LGPD),
//    NAO casa por nome: o CPF nao pode ser confirmado.
// 3) Bate com o titular do termo => 'titular'. Senao, bate com o conjuge (co-
//    assinante) => 'conjuge_titular' (tambem adquiriu pelo contrato Caixa).
// 4) Sem match, com diferenca CONFIRMADA POR CPF (o titular do processo e alguem do
//    termo tem CPF valido e NAO batem) => 'nao_titular'.
// 5) Qualquer outro sem-match (nome divergente sem CPF, CPF mascarado/invalido, ou
//    nada comparavel) => 'review' — sinal fraco demais para impor "nao titular".
export function compareCaixaOwner(
  compradores: CaixaBuyer[],
  conjuges: CaixaBuyer[],
  titular: CaixaTitular,
): CaixaOwnerResult {
  const titularCpf = normalizeCpf(titular.cpf)
  // isValidCpf recebe o valor CRU (nao o normalizeCpf, que faz slice(0,11)): um
  // CPF com digitos a mais precisa ser rejeitado, nao truncado para 11 e aceito.
  const titularCpfValid = isValidCpf(titular.cpf)
  const titularName = normalizeName(titular.fullName)

  const buyerHasValidCpf = (buyer: CaixaBuyer): boolean =>
    !!buyer.cpf && isValidCpf(buyer.cpf)

  // Sem NENHUM digito de CPF no doc (null/''/so pontuacao) — unico caso em que o
  // fallback por nome e seguro. Um CPF presente porem invalido NAO conta como
  // "sem CPF".
  const buyerHasNoCpf = (buyer: CaixaBuyer): boolean =>
    !buyer.cpf || normalizeCpf(buyer.cpf).length === 0

  // Compara o titular do processo contra um grupo do termo (titulares OU conjuges).
  // CPF identico (primario) tem prioridade; nome so como fallback sem-CPF.
  const matchAgainst = (pessoas: CaixaBuyer[]): CaixaOwnerMatch => {
    if (titularCpfValid) {
      for (const pessoa of pessoas) {
        if (
          buyerHasValidCpf(pessoa) &&
          normalizeCpf(pessoa.cpf as string) === titularCpf
        ) {
          return 'cpf'
        }
      }
    }
    if (titularName) {
      for (const pessoa of pessoas) {
        if (
          buyerHasNoCpf(pessoa) &&
          normalizeName(pessoa.nome) === titularName
        ) {
          return 'name'
        }
      }
    }
    return 'none'
  }

  // 1) E o titular do termo?
  const titularMatch = matchAgainst(compradores)
  if (titularMatch !== 'none') {
    return { result: 'titular', matchedBy: titularMatch }
  }

  // 2) E o conjuge (co-titular) do termo? Tambem adquiriu pelo contrato Caixa.
  const conjugeMatch = matchAgainst(conjuges)
  if (conjugeMatch !== 'none') {
    return { result: 'conjuge_titular', matchedBy: conjugeMatch }
  }

  // 3) Sem match identico. So afirmamos 'nao_titular' com DIFERENCA CONFIRMADA POR
  // CPF: o titular do processo tem CPF valido E existe alguem no termo (titular ou
  // conjuge) com CPF valido (logo os CPFs foram comparados e nao bateram). Qualquer
  // outro caso — nome divergente sem CPF, CPF mascarado/invalido, ou nada
  // comparavel — vai para 'review'. Motivo: nome divergente e sinal FRACO para
  // impor uma classificacao adversa (nao_titular torna o contrato_compra_venda
  // obrigatorio); um glitch de OCR no nome (acento, abreviacao) nao deve, sozinho,
  // travar o processo.
  const someoneHasValidCpf =
    compradores.some(buyerHasValidCpf) || conjuges.some(buyerHasValidCpf)
  if (titularCpfValid && someoneHasValidCpf) {
    return { result: 'nao_titular', matchedBy: 'none' }
  }

  return { result: 'review', matchedBy: 'none' }
}

export const CAIXA_OWNER_TITULAR = 'titular_contrato_caixa'
export const CAIXA_OWNER_CONJUGE_TITULAR = 'conjuge_titular_contrato_caixa'
export const CAIXA_OWNER_NAO_TITULAR = 'nao_titular_contrato_caixa'

export type CaixaOwnerOutcome = {
  // Estado operacional resultante (process.caixaAnalysisStatus).
  analysisStatus: 'done' | 'review'
  // Se deve gravar o ownerType concluido (so com CERTEZA + flag ligada + sem lock).
  apply: boolean
  newOwnerType?:
    | typeof CAIXA_OWNER_TITULAR
    | typeof CAIXA_OWNER_CONJUGE_TITULAR
    | typeof CAIXA_OWNER_NAO_TITULAR
  historyEvent: 'CAIXA_OWNER_AUTO_SET' | 'CAIXA_OWNER_REVIEW_REQUIRED' | null
}

// ownerType concluido por resultado da comparacao (review nunca aplica).
const OWNER_TYPE_BY_RESULT = {
  titular: CAIXA_OWNER_TITULAR,
  conjuge_titular: CAIXA_OWNER_CONJUGE_TITULAR,
  nao_titular: CAIXA_OWNER_NAO_TITULAR,
} as const

// Decide o desfecho a partir do resultado deterministico + estado atual do
// processo + flag. PURA (sem I/O). Regras:
// - 'review' (indeterminado) => sempre revisar (humano decide).
// - resultado ja aplicado => no-op.
// - shadow (flag off) => so registra e manda revisar.
// - human-lock => se um humano definiu outro ownerType, nao sobrescreve: revisar.
// - caso contrario, com a flag ligada => auto-aplica o ownerType concluido
//   (titular OU nao_titular).
export function decideCaixaOwnerOutcome(input: {
  result: CaixaOwnerResult['result']
  currentOwnerType: string
  ownerTypeSource: string
  autoApplyEnabled: boolean
}): CaixaOwnerOutcome {
  if (input.result === 'review') {
    return {
      analysisStatus: 'review',
      apply: false,
      historyEvent: 'CAIXA_OWNER_REVIEW_REQUIRED',
    }
  }

  const target = OWNER_TYPE_BY_RESULT[input.result]

  if (input.currentOwnerType === target) {
    return { analysisStatus: 'done', apply: false, historyEvent: null }
  }

  if (!input.autoApplyEnabled) {
    return {
      analysisStatus: 'review',
      apply: false,
      historyEvent: 'CAIXA_OWNER_REVIEW_REQUIRED',
    }
  }

  if (input.ownerTypeSource === 'human' && input.currentOwnerType !== '') {
    return {
      analysisStatus: 'review',
      apply: false,
      historyEvent: 'CAIXA_OWNER_REVIEW_REQUIRED',
    }
  }

  return {
    analysisStatus: 'done',
    apply: true,
    newOwnerType: target,
    historyEvent: 'CAIXA_OWNER_AUTO_SET',
  }
}
