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
// 3) Sem match, mas com diferenca CONFIRMADA (CPF valido diferente, ou nome
//    diferente sem CPF) => 'nao_titular'.
// 4) Sem match e INDETERMINADO (nome igual mas CPF do termo ilegivel/mascarado;
//    ou nada comparavel) => 'review' (nao afirma "nao titular" sem certeza).
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

  // Sem match. Decide entre diferenca CONFIRMADA e INDETERMINADO.
  // Indeterminado: nada comparavel no titular do processo.
  if (!titularCpfValid && !titularName) {
    return { result: 'review', matchedBy: 'none' }
  }
  // Indeterminado: nada para comparar (lista vazia).
  if (compradores.length === 0) {
    return { result: 'review', matchedBy: 'none' }
  }
  // Indeterminado: algum comprador tem o MESMO nome, mas o CPF presente no doc nao
  // pode ser confirmado (mascarado/invalido) — pode ser a mesma pessoa. Nao da pra
  // afirmar "nao e o titular" => revisao humana.
  const nameMatchesButCpfUnconfirmable =
    !!titularName &&
    compradores.some(
      (b) =>
        normalizeName(b.nome) === titularName && !!b.cpf && !isValidCpf(b.cpf),
    )
  if (nameMatchesButCpfUnconfirmable) {
    return { result: 'review', matchedBy: 'none' }
  }

  // Diferenca confirmada: o titular do processo nao e o titular do termo.
  return { result: 'nao_titular', matchedBy: 'none' }
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
