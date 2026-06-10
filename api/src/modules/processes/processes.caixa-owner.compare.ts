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
// 2) Nome so e usado como fallback QUANDO o comprador nao tem CPF valido no doc
//    (CPF diferente = pessoa diferente, mesmo com nome igual: pai/filho).
// 3) Varios compradores (casal): basta UM bater para ser titular.
// 4) Nenhum match identico => 'review'.
export function compareCaixaOwner(
  compradores: CaixaBuyer[],
  titular: CaixaTitular,
): CaixaOwnerResult {
  const titularCpf = normalizeCpf(titular.cpf)
  const titularCpfValid = isValidCpf(titularCpf)
  const titularName = normalizeName(titular.fullName)

  const buyerHasValidCpf = (buyer: CaixaBuyer): boolean =>
    !!buyer.cpf && isValidCpf(normalizeCpf(buyer.cpf))

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

  // 2) Nome identico (fallback) — so para compradores SEM CPF valido no doc.
  if (titularName) {
    for (const buyer of compradores) {
      if (
        !buyerHasValidCpf(buyer) &&
        normalizeName(buyer.nome) === titularName
      ) {
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
