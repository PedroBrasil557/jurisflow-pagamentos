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
  // Auto-aplica SO 'titular'. Tudo que nao for match identico vira 'review'
  // (humano decide; o sistema nunca auto-aplica "nao titular").
  result: 'titular' | 'review'
  matchedBy: CaixaOwnerMatch
}

// Decisao DETERMINISTICA (codigo, nunca o LLM). Precisao sobre recall:
// 1) CPF e o sinal primario — exige ambos validos (checksum) e iguais.
// 2) Nome so e usado como fallback QUANDO o comprador NAO TRAZ CPF no doc.
//    Se o doc traz um CPF (mesmo mascarado/parcial, ex.: "111.444.***-**" — comum
//    por LGPD), NAO casar por nome: o CPF e um sinal de identidade conflitante
//    que invalida o match por homonimo (dois "Jose da Silva" distintos) => review.
// 3) Varios compradores (casal): basta UM bater para ser titular.
// 4) Nenhum match identico => 'review'.
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

  return { result: 'review', matchedBy: 'none' }
}

export const CAIXA_OWNER_TITULAR = 'titular_contrato_caixa'

export type CaixaOwnerOutcome = {
  // Estado operacional resultante (process.caixaAnalysisStatus).
  analysisStatus: 'done' | 'review'
  // Se deve gravar ownerType = titular (so quando ha CERTEZA + flag ligada).
  apply: boolean
  newOwnerType?: typeof CAIXA_OWNER_TITULAR
  historyEvent: 'CAIXA_OWNER_AUTO_SET' | 'CAIXA_OWNER_REVIEW_REQUIRED' | null
}

// Decide o desfecho a partir do resultado deterministico + estado atual do
// processo + flag. PURA (sem I/O). Regras:
// - 'review' => sempre revisar (nunca auto-aplica "nao titular").
// - 'titular' ja aplicado => no-op.
// - shadow (flag off) => mesmo com 'titular', so registra e manda revisar.
// - human-lock => se um humano definiu outro ownerType, nao sobrescreve: revisar.
// - caso contrario, com a flag ligada => auto-aplica titular.
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

  if (input.currentOwnerType === CAIXA_OWNER_TITULAR) {
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
    newOwnerType: CAIXA_OWNER_TITULAR,
    historyEvent: 'CAIXA_OWNER_AUTO_SET',
  }
}
