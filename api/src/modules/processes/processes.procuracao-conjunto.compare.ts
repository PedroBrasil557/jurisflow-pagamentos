import { normalizeName } from '../../shared/utils/name'

// Conjunto (residencial/condominio) do cadastro, reduzido ao necessario para o
// match.
export type ConjuntoRecord = {
  id: string
  name: string
  city: string | null
}

export type ConjuntoMatchBy = 'name' | 'name+city' | 'none'

export type ConjuntoMatchResult = {
  // Auto-aplica SO 'match' (1 conjunto inequivoco). Tudo ambiguo/ausente vira
  // 'review' — o conjunto dirige a vara/valor da peticao, entao nunca chutamos.
  result: 'match' | 'review'
  conjunto?: ConjuntoRecord
  matchedBy: ConjuntoMatchBy
}

// Nome minimo (normalizado) para considerar um match: nomes muito curtos casariam
// por acaso no endereco. Conservador de proposito (risco juridico).
const MIN_NAME_LEN = 6

// Normaliza para BUSCA: sem acento/caixa (normalizeName) + pontuacao virando
// espaco (virgula/barra/hifen ao redor do nome nao podem quebrar a fronteira de
// palavra) + espaco unico.
function toSearchable(value: string): string {
  return normalizeName(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// O nome aparece como SEQUENCIA DE PALAVRAS COMPLETAS no texto (fronteira por
// espaco), nao como substring solto — evita "VILA" casar em "VILAREJO" ou
// "VILA NOVA" em "VILA NOVA DE GAIA" (so casa se as palavras forem contiguas e
// inteiras). Ambos ja vem por toSearchable (sem acento/pontuacao, maiusculo).
function containsWordSequence(haystack: string, needle: string): boolean {
  if (!needle) {
    return false
  }
  return ` ${haystack} `.includes(` ${needle} `)
}

// Match DETERMINISTICO do conjunto mencionado no endereco da procuracao contra o
// cadastro. NAO faz fuzzy/typo (igual ao comparador do contrato Caixa): so
// auto-aplica em match IDENTICO + inequivoco; o resto cai em revisao humana.
export function matchConjuntoInAddress(
  input: { addressText: string; addressCity?: string | null },
  conjuntos: ConjuntoRecord[],
): ConjuntoMatchResult {
  const haystack = toSearchable(input.addressText)
  if (!haystack) {
    return { result: 'review', matchedBy: 'none' }
  }

  // Conjuntos cujo nome (palavra completa, tamanho seguro) aparece no endereco.
  const found = conjuntos.filter((conjunto) => {
    const name = toSearchable(conjunto.name)
    return name.length >= MIN_NAME_LEN && containsWordSequence(haystack, name)
  })

  if (found.length === 0) {
    return { result: 'review', matchedBy: 'none' }
  }

  if (found.length === 1) {
    return { result: 'match', conjunto: found[0], matchedBy: 'name' }
  }

  // Mais de um nome casou. 1) desambigua pela cidade do endereco.
  const city = input.addressCity ? toSearchable(input.addressCity) : ''
  if (city) {
    const byCity = found.filter(
      (conjunto) => conjunto.city && toSearchable(conjunto.city) === city,
    )
    if (byCity.length === 1) {
      return { result: 'match', conjunto: byCity[0], matchedBy: 'name+city' }
    }
  }

  // 2) prefere o nome mais ESPECIFICO (mais longo) — ex.: "RESIDENCIAL VILA
  // NOVA" sobre "VILA NOVA" quando ambos casam — so se houver um unico mais longo.
  const byLength = [...found].sort(
    (a, b) => toSearchable(b.name).length - toSearchable(a.name).length,
  )
  const longestLen = toSearchable(byLength[0].name).length
  const longest = byLength.filter(
    (conjunto) => toSearchable(conjunto.name).length === longestLen,
  )
  if (longest.length === 1) {
    return { result: 'match', conjunto: longest[0], matchedBy: 'name' }
  }

  // Ainda ambiguo (mesmo nome, mesma cidade/tamanho) → revisao humana.
  return { result: 'review', matchedBy: 'none' }
}

export const PROCURACAO_CONJUNTO_HISTORY = {
  AUTO_SET: 'PROCURACAO_CONJUNTO_AUTO_SET',
  REVIEW: 'PROCURACAO_CONJUNTO_REVIEW_REQUIRED',
  // Humano escolheu OUTRO conjunto: nunca sobrescreve calado — alerta.
  DIVERGENCE: 'PROCURACAO_CONJUNTO_DIVERGENCE',
} as const

export type ProcuracaoConjuntoHistoryEvent =
  (typeof PROCURACAO_CONJUNTO_HISTORY)[keyof typeof PROCURACAO_CONJUNTO_HISTORY]

export type ProcuracaoConjuntoOutcome = {
  // Estado operacional (process.procuracao_conjunto_status).
  analysisStatus: 'done' | 'review'
  // Se deve gravar process.housingComplex = newHousingComplex.
  apply: boolean
  newHousingComplex?: string
  // Divergencia: a procuracao indica um conjunto diferente do que ja esta no
  // processo (escolhido por humano) — para destacar na UI, nao para sobrescrever.
  divergence: boolean
  historyEvent: ProcuracaoConjuntoHistoryEvent | null
}

// Decide o desfecho a partir do match determinístico + estado atual + flag. PURA.
// Mesmo padrao do auto-apply gated por flag/human-lock. Regras:
// - sem match inequivoco => sempre revisar (nunca chuta — risco juridico).
// - ja e o conjunto casado => no-op.
// - shadow (flag off) => so registra e revisar.
// - human-lock + divergencia => humano escolheu OUTRO: NAO sobrescreve, alerta.
// - confiante + flag on + nao-travado => auto-aplica o conjunto casado.
export function decideProcuracaoConjuntoOutcome(input: {
  matchResult: ConjuntoMatchResult
  currentHousingComplex: string
  housingComplexSource: string
  autoApplyEnabled: boolean
}): ProcuracaoConjuntoOutcome {
  const matched = input.matchResult.conjunto

  if (input.matchResult.result === 'review' || !matched) {
    return {
      analysisStatus: 'review',
      apply: false,
      divergence: false,
      historyEvent: PROCURACAO_CONJUNTO_HISTORY.REVIEW,
    }
  }

  const current = input.currentHousingComplex.trim()
  const sameAsCurrent =
    current !== '' && normalizeName(current) === normalizeName(matched.name)

  if (sameAsCurrent) {
    return {
      analysisStatus: 'done',
      apply: false,
      divergence: false,
      historyEvent: null,
    }
  }

  if (!input.autoApplyEnabled) {
    return {
      analysisStatus: 'review',
      apply: false,
      divergence: current !== '',
      historyEvent: PROCURACAO_CONJUNTO_HISTORY.REVIEW,
    }
  }

  // Human-lock: um humano definiu OUTRO conjunto. Nao sobrescreve — alerta.
  if (input.housingComplexSource === 'human' && current !== '') {
    return {
      analysisStatus: 'review',
      apply: false,
      divergence: true,
      historyEvent: PROCURACAO_CONJUNTO_HISTORY.DIVERGENCE,
    }
  }

  // Confiante + flag on + nao-travado-por-humano => auto-aplica.
  return {
    analysisStatus: 'done',
    apply: true,
    newHousingComplex: matched.name,
    divergence: false,
    historyEvent: PROCURACAO_CONJUNTO_HISTORY.AUTO_SET,
  }
}
