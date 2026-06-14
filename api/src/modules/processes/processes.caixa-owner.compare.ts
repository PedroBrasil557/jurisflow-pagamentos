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
  // A eleicao do ownerType compara o titular do PROCESSO com os compradores do
  // TERMO. Modelo de 2 estados (v3 — co-comprador/conjuge colapsado no titular):
  // - 'titular'     => bate com um comprador do termo (titular do contrato Caixa).
  // - 'nao_titular' => diferenca CONFIRMADA por CPF (titular do processo nao consta
  //   entre os compradores). Comprou de terceiro => exige contrato de compra e venda.
  // - 'review'      => INDETERMINADO (nao da pra afirmar igualdade nem diferenca).
  result: 'titular' | 'nao_titular' | 'review'
  matchedBy: CaixaOwnerMatch
}

// Decisao DETERMINISTICA (codigo, nunca o LLM). Precisao sobre recall:
// 1) CPF e o sinal primario — exige ambos validos (checksum) e iguais.
// 2) Nome so e usado como fallback QUANDO a pessoa NAO TRAZ CPF no doc. Se o doc
//    traz um CPF (mesmo mascarado/parcial, ex.: "111.444.***-**" — comum por LGPD),
//    NAO casa por nome: o CPF nao pode ser confirmado.
// 3) Bate com um comprador do termo => 'titular'.
// 4) Sem match, com diferenca CONFIRMADA POR CPF (o titular do processo e alguem do
//    termo tem CPF valido e NAO batem) => 'nao_titular'.
// 5) Qualquer outro sem-match (nome divergente sem CPF, CPF mascarado/invalido, ou
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

  // Compara o titular do processo contra os compradores do termo. CPF identico
  // (primario) tem prioridade; nome so como fallback sem-CPF.
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

  // 1) E um comprador do termo?
  const titularMatch = matchAgainst(compradores)
  if (titularMatch !== 'none') {
    return { result: 'titular', matchedBy: titularMatch }
  }

  // 2) Sem match identico. So afirmamos 'nao_titular' com DIFERENCA CONFIRMADA POR
  // CPF: o titular do processo tem CPF valido E existe alguem no termo com CPF
  // valido (logo os CPFs foram comparados e nao bateram). Qualquer outro caso —
  // nome divergente sem CPF, CPF mascarado/invalido, ou nada comparavel — vai para
  // 'review'. Motivo: nome divergente e sinal FRACO para impor uma classificacao
  // adversa (nao_titular torna o contrato_compra_venda obrigatorio); um glitch de
  // OCR no nome (acento, abreviacao) nao deve, sozinho, travar o processo.
  const someoneHasValidCpf = compradores.some(buyerHasValidCpf)
  if (titularCpfValid && someoneHasValidCpf) {
    return { result: 'nao_titular', matchedBy: 'none' }
  }

  return { result: 'review', matchedBy: 'none' }
}
