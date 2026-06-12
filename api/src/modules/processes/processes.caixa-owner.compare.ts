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
  // A eleicao do ownerType e feita comparando o titular do PROCESSO com o titular
  // do TERMO (o conjuge nao entra — filtrado no service). Tres desfechos:
  // - 'titular'     => match identico (e o titular do contrato Caixa).
  // - 'nao_titular' => diferenca CONFIRMADA (titular do processo != titular do termo).
  // - 'review'      => INDETERMINADO (nao da pra afirmar igualdade nem diferenca).
  result: 'titular' | 'nao_titular' | 'review'
  matchedBy: CaixaOwnerMatch
}

// Decisao DETERMINISTICA (codigo, nunca o LLM). Precisao sobre recall:
// 1) CPF e o sinal primario — exige ambos validos (checksum) e iguais => 'titular'.
// 2) Nome so e usado como fallback QUANDO o comprador NAO TRAZ CPF no doc => 'titular'.
//    Se o doc traz um CPF (mesmo mascarado/parcial, ex.: "111.444.***-**" — comum
//    por LGPD), NAO casa por nome: o CPF nao pode ser confirmado.
// 3) Sem match, com diferenca CONFIRMADA POR CPF (o titular e algum comprador tem
//    CPF valido e NAO batem) => 'nao_titular'.
// 4) Qualquer outro sem-match (nome divergente sem CPF, CPF mascarado/invalido, ou
//    nada comparavel) => 'review' — sinal fraco demais para impor "nao titular".
export function compareCaixaOwner(
  compradores: CaixaBuyer[],
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

  // 1) CPF identico (primario).
  if (titularCpfValid) {
    for (const buyer of compradores) {
      if (
        buyerHasValidCpf(buyer) &&
        normalizeCpf(buyer.cpf as string) === titularCpf
      ) {
        return { result: 'titular', matchedBy: 'cpf' }
      }
    }
  }

  // 2) Nome identico (fallback) — so para compradores que NAO trazem CPF no doc.
  if (titularName) {
    for (const buyer of compradores) {
      if (buyerHasNoCpf(buyer) && normalizeName(buyer.nome) === titularName) {
        return { result: 'titular', matchedBy: 'name' }
      }
    }
  }

  // Sem match identico. So afirmamos 'nao_titular' com DIFERENCA CONFIRMADA POR CPF:
  // o titular do processo tem CPF valido E existe um comprador com CPF valido (logo
  // os CPFs foram comparados e nao bateram). Qualquer outro caso — nome divergente
  // sem CPF, CPF mascarado/invalido, ou nada comparavel — vai para 'review'.
  // Motivo: nome divergente e sinal FRACO para impor uma classificacao adversa
  // (nao_titular torna o contrato_compra_venda obrigatorio); um glitch de OCR no
  // nome (acento, abreviacao) nao deve, sozinho, travar o processo.
  const someBuyerHasValidCpf = compradores.some(buyerHasValidCpf)
  if (titularCpfValid && someBuyerHasValidCpf) {
    return { result: 'nao_titular', matchedBy: 'none' }
  }

  return { result: 'review', matchedBy: 'none' }
}

export const CAIXA_OWNER_TITULAR = 'titular_contrato_caixa'
export const CAIXA_OWNER_NAO_TITULAR = 'nao_titular_contrato_caixa'

export type CaixaOwnerOutcome = {
  // Estado operacional resultante (process.caixaAnalysisStatus).
  analysisStatus: 'done' | 'review'
  // Se deve gravar o ownerType concluido (so com CERTEZA + flag ligada + sem lock).
  apply: boolean
  newOwnerType?: typeof CAIXA_OWNER_TITULAR | typeof CAIXA_OWNER_NAO_TITULAR
  historyEvent: 'CAIXA_OWNER_AUTO_SET' | 'CAIXA_OWNER_REVIEW_REQUIRED' | null
}

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

  const target =
    input.result === 'titular' ? CAIXA_OWNER_TITULAR : CAIXA_OWNER_NAO_TITULAR

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
