// Motor PURO do modulo Pagamentos (sem banco, sem relogio, sem I/O).
// Especificacao: V3 §20-24 (docs/pagamentos/CONTRATO.md). O CODIGO conhece as
// etapas e as operacoes; a CONFIGURACAO (regras) conhece recebedores, bases,
// percentuais, valores, vigencias e condominios. Nenhum nome ou percentual de
// negocio existe aqui (INV-11/INV-12): sem regra configurada, o calculo BLOQUEIA.
// Mudanca de formula exige nova FINANCE_ALGORITHM_VERSION.

import {
  assertCents,
  exactPercentOfCents,
  formatBasisPoints,
  formatCentsBRL,
} from './finance.money'

export const FINANCE_ALGORITHM_VERSION = 'pagamentos-motor-v3.0'

/**
 * Etapas configuraveis, na ordem fixa do motor. A base de cada etapa e fixa no
 * codigo (V3 §20): A = receita total, C = receita liquida, J = resultado 1,
 * M = resultado 2.
 */
export const financeRuleStages = [
  'PROVISAO_RECEITA', // B: sobre A
  'DEDUCAO_LIQUIDA', // E/F/G/H: sobre C
  'RESERVA', // I: valor fixo ou % de C, com politica de unicidade
  'PARTICIPACAO_RESULTADO', // L: sobre J
  'DISTRIBUICAO_FINAL', // N...: sobre M, soma 100%
] as const
export type FinanceRuleStage = (typeof financeRuleStages)[number]

export const financeRuleNatures = ['CREDITO', 'PROVISAO', 'RESERVA'] as const
export type FinanceRuleNature = (typeof financeRuleNatures)[number]

export const financeValueTypes = ['PERCENTUAL', 'VALOR_FIXO'] as const
export type FinanceValueType = (typeof financeValueTypes)[number]

export const financeUniquenessPolicies = [
  'NENHUMA',
  'UNICA_POR_PROCESSO',
] as const
export type FinanceUniquenessPolicy = (typeof financeUniquenessPolicies)[number]

export const financeConfigOrigins = ['MANUAL', 'IMPORTACAO'] as const
export type FinanceConfigOrigin = (typeof financeConfigOrigins)[number]

export type FinanceBaseKey = 'A' | 'C' | 'J' | 'M'

export const stageBase: Record<FinanceRuleStage, FinanceBaseKey> = {
  PROVISAO_RECEITA: 'A',
  DEDUCAO_LIQUIDA: 'C',
  RESERVA: 'C',
  PARTICIPACAO_RESULTADO: 'J',
  DISTRIBUICAO_FINAL: 'M',
}

/** Naturezas aceitas por etapa. */
export const stageNatures: Record<FinanceRuleStage, FinanceRuleNature[]> = {
  PROVISAO_RECEITA: ['PROVISAO'],
  DEDUCAO_LIQUIDA: ['CREDITO', 'PROVISAO'],
  RESERVA: ['RESERVA'],
  PARTICIPACAO_RESULTADO: ['CREDITO'],
  DISTRIBUICAO_FINAL: ['CREDITO'],
}

/**
 * Etapas que EXIGEM configuracao (V3 §7 "se a etapa exigir aquela configuracao,
 * o calculo fica bloqueado"). Decisao tecnica documentada: sem provisao sobre a
 * receita nao se sabe o liquido; sem distribuicao final o resultado ficaria sem
 * destino. 0% explicitamente configurado satisfaz a exigencia (INV-04).
 */
export const requiredStages: readonly FinanceRuleStage[] = [
  'PROVISAO_RECEITA',
  'DISTRIBUICAO_FINAL',
]

export const stageLabels: Record<FinanceRuleStage, string> = {
  PROVISAO_RECEITA: 'Provisões sobre a receita (B)',
  DEDUCAO_LIQUIDA: 'Deduções sobre a receita líquida (E–H)',
  RESERVA: 'Reservas (I)',
  PARTICIPACAO_RESULTADO: 'Participações sobre o resultado 1 (L)',
  DISTRIBUICAO_FINAL: 'Distribuição final (N)',
}

export type FinanceEngineRule = {
  /** id da VERSAO */
  id: string
  /** identidade estavel da regra entre versoes */
  lineageId: string
  version: number
  stage: FinanceRuleStage
  nature: FinanceRuleNature
  /** obrigatorio para CREDITO */
  recipientId: string | null
  recipientName: string | null
  /** obrigatorio para PROVISAO/RESERVA: chave normalizada da reserva */
  poolKey: string | null
  poolLabel: string | null
  /** funcao/trabalho (texto livre, apenas informativo e de desambiguacao) */
  workType: string
  valueType: FinanceValueType
  /** null = NAO CONFIGURADO (bloqueia); 0 = 0% configurado (valido) */
  basisPoints: number | null
  /** null = NAO CONFIGURADO (bloqueia); 0 = R$ 0,00 configurado (valido) */
  fixedCents: number | null
  sortOrder: number
  uniqueness: FinanceUniquenessPolicy
  /** YYYY-MM-DD inclusivo */
  validFrom: string
  /** YYYY-MM-DD inclusivo; null = aberta */
  validTo: string | null
  /** vazio = regra global, aplicada a qualquer condominio do processo */
  housingComplexIds: readonly string[]
  origin: FinanceConfigOrigin
}

export type FinanceReceiptInput = {
  receiptId: string
  processId: string
  housingComplexId: string | null
  /** data de cadastro do cliente (YYYY-MM-DD) — seleciona a vigencia (INV-02) */
  clientRegistrationDate: string | null
  grossCents: number
  releaseDate: string | null
  /** desempate deterministico da reserva unica (ISO) */
  createdAt: string
}

export type FinanceBlockCode =
  | 'VALOR_INVALIDO'
  | 'DATA_LIBERACAO_AUSENTE'
  | 'DATA_CADASTRO_AUSENTE'
  | 'PROCESSO_SEM_CONDOMINIO'
  | 'SEM_REGRA_APLICAVEL'
  | 'VIGENCIA_INCOMPATIVEL'
  | 'CONDOMINIO_INCOMPATIVEL'
  | 'ETAPA_OBRIGATORIA_SEM_REGRA'
  | 'PARAMETRO_NAO_CONFIGURADO'
  | 'REGRA_AMBIGUA'
  | 'REGRA_INVALIDA'
  | 'DISTRIBUICAO_FINAL_INCONSISTENTE'
  | 'RESULTADO_NEGATIVO'
  | 'MEMORIA_INCONSISTENTE'

export type FinanceBlock = {
  code: FinanceBlockCode
  /** causa */
  message: string
  /** caminho de correcao */
  fix: string
  ruleId?: string
  stage?: FinanceRuleStage
}

export type FinanceStepKind =
  | 'RECEITA_TOTAL'
  | 'PROVISAO_RECEITA'
  | 'TOTAL_PROVISOES'
  | 'RECEITA_LIQUIDA'
  | 'DEDUCAO_LIQUIDA'
  | 'RESERVA'
  | 'TOTAL_DEDUCOES'
  | 'RESULTADO_1'
  | 'PARTICIPACAO_RESULTADO'
  | 'RESULTADO_2'
  | 'DISTRIBUICAO_FINAL'
  | 'SALDO_FINAL'

export type FinanceRounding =
  | 'EXATO'
  | 'MEIO_PARA_CIMA'
  | 'MAIOR_RESTO'
  | 'NAO_SE_APLICA'

export type FinanceCalcStep = {
  order: number
  /** letra da planilha de referencia: A, B, B.1, C, E.1, I.1, D, J, L.1, M, N.1, P */
  code: string
  kind: FinanceStepKind
  description: string
  baseKey: FinanceBaseKey | null
  baseCents: number | null
  ruleId: string | null
  ruleLineageId: string | null
  ruleVersion: number | null
  valueType: FinanceValueType | null
  basisPoints: number | null
  fixedCents: number | null
  formula: string
  /** valor exato antes do arredondamento, em centavos com 4 casas */
  exactCents: string | null
  rounding: FinanceRounding
  amountCents: number
  nature: FinanceRuleNature | null
  recipientId: string | null
  recipientName: string | null
  poolKey: string | null
  poolLabel: string | null
  workType: string | null
  uniqueness: FinanceUniquenessPolicy | null
  /** parcela de A (soma das parcelas = A); subtotais/resultados sao false */
  isAllocation: boolean
  note: string | null
}

export type FinanceTotals = {
  A: number
  B: number
  C: number
  D: number
  J: number
  L: number
  M: number
  N: number
  P: number
  creditsCents: number
  provisionsCents: number
  reservesCents: number
}

export type FinanceReceiptCalculation = {
  algorithmVersion: string
  receiptId: string
  processId: string
  housingComplexId: string | null
  clientRegistrationDate: string | null
  blocked: boolean
  blocks: FinanceBlock[]
  steps: FinanceCalcStep[]
  totals: FinanceTotals | null
  /** copia integral das versoes de regra aplicadas (snapshot) */
  rulesUsed: FinanceEngineRule[]
  /** reservas unicas constituidas por este calculo */
  uniqueReserveKeys: string[]
}

export function uniqueReserveKey(poolKey: string, processId: string): string {
  return `${poolKey}|${processId}`
}

/** "Certidão Cartório" -> "certidao-cartorio" (chave estavel da reserva). */
export function normalizePoolKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function ruleAppliesToDate(rule: FinanceEngineRule, date: string) {
  if (date < rule.validFrom) return false
  return rule.validTo === null || date <= rule.validTo
}

export function ruleAppliesToComplex(
  rule: FinanceEngineRule,
  housingComplexId: string | null,
) {
  if (housingComplexId === null) return false
  return (
    rule.housingComplexIds.length === 0 ||
    rule.housingComplexIds.includes(housingComplexId)
  )
}

/** Chave de "mesmo contexto e etapa" (V3 §7 sobreposicao). */
export function ruleContextKey(rule: FinanceEngineRule): string {
  const who = rule.recipientId ?? `reserva:${rule.poolKey ?? ''}`
  return `${rule.stage}|${who}|${rule.workType.trim().toLowerCase()}`
}

function compareRules(a: FinanceEngineRule, b: FinanceEngineRule): number {
  const stageDiff =
    financeRuleStages.indexOf(a.stage) - financeRuleStages.indexOf(b.stage)
  if (stageDiff !== 0) return stageDiff
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.lineageId !== b.lineageId) return a.lineageId < b.lineageId ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function ruleDisplayName(rule: FinanceEngineRule): string {
  const who = rule.recipientName ?? rule.poolLabel ?? 'Regra'
  return rule.workType ? `${who} · ${rule.workType}` : who
}

/** Valida a FORMA de uma versao de regra (servidor, antes de gravar). */
export function validateRuleShape(rule: FinanceEngineRule): string[] {
  const errors: string[] = []
  if (!financeRuleStages.includes(rule.stage)) errors.push('Etapa inválida.')
  if (!stageNatures[rule.stage]?.includes(rule.nature)) {
    errors.push('Natureza incompatível com a etapa.')
  }
  if (rule.nature === 'CREDITO' && !rule.recipientId) {
    errors.push('Regra de crédito exige recebedor.')
  }
  if (rule.nature !== 'CREDITO' && !rule.poolKey) {
    errors.push('Provisão/reserva exige o nome da reserva.')
  }
  if (rule.nature !== 'CREDITO' && rule.recipientId) {
    errors.push(
      'Provisão/reserva não tem recebedor; o valor vai para a reserva.',
    )
  }
  if (rule.validTo !== null && rule.validTo < rule.validFrom) {
    errors.push('O fim da vigência deve ser igual ou posterior ao início.')
  }
  if (rule.valueType === 'PERCENTUAL') {
    if (rule.fixedCents !== null) {
      errors.push('Regra percentual não usa valor fixo.')
    }
    if (
      rule.basisPoints !== null &&
      (!Number.isInteger(rule.basisPoints) ||
        rule.basisPoints < 0 ||
        rule.basisPoints > 10_000)
    ) {
      errors.push('Percentual deve estar entre 0,00% e 100,00%.')
    }
  } else {
    if (rule.basisPoints !== null) {
      errors.push('Regra de valor fixo não usa percentual.')
    }
    if (
      rule.fixedCents !== null &&
      (!Number.isSafeInteger(rule.fixedCents) || rule.fixedCents < 0)
    ) {
      errors.push('Valor fixo deve ser zero ou positivo, em centavos.')
    }
    if (rule.stage === 'DISTRIBUICAO_FINAL') {
      errors.push('A distribuição final aceita apenas percentuais (soma 100%).')
    }
  }
  if (rule.uniqueness === 'UNICA_POR_PROCESSO' && rule.stage !== 'RESERVA') {
    errors.push('Unicidade por processo só se aplica a reservas.')
  }
  if (!Number.isInteger(rule.sortOrder) || rule.sortOrder < 0) {
    errors.push('Ordem deve ser inteira e não negativa.')
  }
  return errors
}

export type FinanceRuleConflict = {
  ruleId: string
  conflictingRuleId: string
  message: string
}

function rangesOverlap(
  a: Pick<FinanceEngineRule, 'validFrom' | 'validTo'>,
  b: Pick<FinanceEngineRule, 'validFrom' | 'validTo'>,
): boolean {
  const aEndsBeforeB = a.validTo !== null && a.validTo < b.validFrom
  const bEndsBeforeA = b.validTo !== null && b.validTo < a.validFrom
  return !aEndsBeforeB && !bEndsBeforeA
}

/**
 * Sobreposicao ambigua (V3 §7): mesmo contexto/etapa, escopo global ou algum
 * condominio em comum e vigencias que se interceptam. Versoes da MESMA linhagem
 * sao ignoradas quando `ignoreLineageId` e informado (nova versao encerra a
 * anterior).
 */
export function findRuleConflicts(
  candidate: FinanceEngineRule,
  active: readonly FinanceEngineRule[],
  ignoreLineageId?: string,
): FinanceRuleConflict[] {
  const key = ruleContextKey(candidate)
  const conflicts: FinanceRuleConflict[] = []
  for (const other of active) {
    if (other.id === candidate.id) continue
    if (ignoreLineageId && other.lineageId === ignoreLineageId) continue
    if (ruleContextKey(other) !== key) continue
    const candidateGlobal = candidate.housingComplexIds.length === 0
    const otherGlobal = other.housingComplexIds.length === 0
    if (
      !candidateGlobal &&
      !otherGlobal &&
      !other.housingComplexIds.some((id) =>
        candidate.housingComplexIds.includes(id),
      )
    ) {
      continue
    }
    if (!rangesOverlap(candidate, other)) continue
    conflicts.push({
      ruleId: candidate.id,
      conflictingRuleId: other.id,
      message: `${ruleDisplayName(other)} já possui regra em ${stageLabels[other.stage]} com escopo e vigência sobrepostos (${other.validFrom} a ${other.validTo ?? 'aberta'}).`,
    })
  }
  return conflicts
}

// ---------------------------------------------------------------------------
// Calculo

function block(
  code: FinanceBlockCode,
  message: string,
  fix: string,
  extra: Partial<FinanceBlock> = {},
): FinanceBlock {
  return { code, message, fix, ...extra }
}

/**
 * Calcula UM recebimento. `constitutedUniqueReserves` contem as chaves
 * (reserva|processo) ja constituidas — em fechamentos anteriores ou por um
 * recebimento anterior do mesmo lote.
 */
export function calculateReceipt(input: {
  receipt: FinanceReceiptInput
  rules: readonly FinanceEngineRule[]
  constitutedUniqueReserves: ReadonlySet<string>
}): FinanceReceiptCalculation {
  const { receipt } = input
  const blocks: FinanceBlock[] = []
  const result = (
    steps: FinanceCalcStep[],
    totals: FinanceTotals | null,
    rulesUsed: FinanceEngineRule[],
    uniqueReserveKeys: string[],
  ): FinanceReceiptCalculation => ({
    algorithmVersion: FINANCE_ALGORITHM_VERSION,
    receiptId: receipt.receiptId,
    processId: receipt.processId,
    housingComplexId: receipt.housingComplexId,
    clientRegistrationDate: receipt.clientRegistrationDate,
    blocked: blocks.length > 0,
    blocks,
    steps: blocks.length > 0 ? [] : steps,
    totals: blocks.length > 0 ? null : totals,
    rulesUsed: blocks.length > 0 ? [] : rulesUsed,
    uniqueReserveKeys: blocks.length > 0 ? [] : uniqueReserveKeys,
  })

  // --- dados minimos (V3 §11/§13)
  if (!Number.isSafeInteger(receipt.grossCents) || receipt.grossCents <= 0) {
    blocks.push(
      block(
        'VALOR_INVALIDO',
        'O valor bruto deve ser maior que zero.',
        'Corrija o valor do recebimento.',
      ),
    )
  }
  if (!receipt.releaseDate) {
    blocks.push(
      block(
        'DATA_LIBERACAO_AUSENTE',
        'Data de liberação na conta não informada.',
        'Informe a data em que o valor foi liberado.',
      ),
    )
  }
  if (!receipt.clientRegistrationDate) {
    blocks.push(
      block(
        'DATA_CADASTRO_AUSENTE',
        'O cliente/processo não tem data de cadastro para selecionar a vigência.',
        'Revise o cadastro do processo.',
      ),
    )
  }
  if (!receipt.housingComplexId) {
    blocks.push(
      block(
        'PROCESSO_SEM_CONDOMINIO',
        'O processo não está vinculado a um condomínio; nenhuma regra pode ser selecionada.',
        'Vincule o processo a um condomínio cadastrado.',
      ),
    )
  }
  if (blocks.length > 0) return result([], null, [], [])

  const date = receipt.clientRegistrationDate as string
  const complexId = receipt.housingComplexId as string

  // --- selecao de regras (INV-02 data de cadastro, INV-03 condominio)
  const byComplex = input.rules.filter((r) =>
    ruleAppliesToComplex(r, complexId),
  )
  const byDate = input.rules.filter((r) => ruleAppliesToDate(r, date))
  const applicable = byComplex
    .filter((r) => ruleAppliesToDate(r, date))
    .sort(compareRules)

  if (applicable.length === 0) {
    if (input.rules.length === 0) {
      blocks.push(
        block(
          'SEM_REGRA_APLICAVEL',
          'Não há nenhuma regra de pagamento configurada.',
          'Cadastre ou importe as regras em Pagamentos › Configuração.',
        ),
      )
    } else if (byComplex.length > 0) {
      blocks.push(
        block(
          'VIGENCIA_INCOMPATIVEL',
          `Há regras para o condomínio, mas nenhuma vigente em ${date} (data de cadastro do cliente).`,
          'Cadastre uma versão de regra cuja vigência inclua a data de cadastro.',
        ),
      )
    } else if (byDate.length > 0) {
      blocks.push(
        block(
          'CONDOMINIO_INCOMPATIVEL',
          'Há regras vigentes na data de cadastro, mas nenhuma vinculada ao condomínio do processo.',
          'Vincule o condomínio do processo às regras aplicáveis.',
        ),
      )
    } else {
      blocks.push(
        block(
          'SEM_REGRA_APLICAVEL',
          'Nenhuma regra corresponde ao condomínio e à data de cadastro do cliente.',
          'Cadastre regras para este condomínio e vigência.',
        ),
      )
    }
    return result([], null, [], [])
  }

  // --- validacoes das regras aplicaveis
  const contextKeys = new Map<string, FinanceEngineRule>()
  for (const rule of applicable) {
    const shapeErrors = validateRuleShape(rule)
    if (shapeErrors.length > 0) {
      blocks.push(
        block(
          'REGRA_INVALIDA',
          `${ruleDisplayName(rule)}: ${shapeErrors.join(' ')}`,
          'Corrija a regra em Pagamentos › Configuração.',
          { ruleId: rule.id, stage: rule.stage },
        ),
      )
    }
    const key = ruleContextKey(rule)
    const previous = contextKeys.get(key)
    if (previous) {
      blocks.push(
        block(
          'REGRA_AMBIGUA',
          `${ruleDisplayName(rule)} tem mais de uma regra aplicável em ${stageLabels[rule.stage]}.`,
          'Ajuste as vigências para que apenas uma versão se aplique.',
          { ruleId: rule.id, stage: rule.stage },
        ),
      )
    }
    contextKeys.set(key, rule)
    const missing =
      rule.valueType === 'PERCENTUAL'
        ? rule.basisPoints === null
        : rule.fixedCents === null
    if (missing) {
      blocks.push(
        block(
          'PARAMETRO_NAO_CONFIGURADO',
          `${ruleDisplayName(rule)}: ${rule.valueType === 'PERCENTUAL' ? 'percentual' : 'valor'} não configurado em ${stageLabels[rule.stage]}.`,
          'Informe o parâmetro (0% é aceito quando for a intenção).',
          { ruleId: rule.id, stage: rule.stage },
        ),
      )
    }
  }
  for (const stage of requiredStages) {
    if (!applicable.some((rule) => rule.stage === stage)) {
      blocks.push(
        block(
          'ETAPA_OBRIGATORIA_SEM_REGRA',
          `Etapa obrigatória sem regra aplicável: ${stageLabels[stage]}.`,
          'Configure a etapa (0% explícito é válido).',
          { stage },
        ),
      )
    }
  }
  const finals = applicable.filter((r) => r.stage === 'DISTRIBUICAO_FINAL')
  const finalBps = finals.reduce((sum, r) => sum + (r.basisPoints ?? 0), 0)
  if (finals.length > 0 && finalBps !== 10_000) {
    blocks.push(
      block(
        'DISTRIBUICAO_FINAL_INCONSISTENTE',
        `A distribuição final soma ${formatBasisPoints(finalBps)}; precisa somar exatamente 100,00% do resultado 2 (INV-09).`,
        'Ajuste os percentuais da distribuição final.',
        { stage: 'DISTRIBUICAO_FINAL' },
      ),
    )
  }
  if (blocks.length > 0) return result([], null, [], [])

  // --- pipeline A..P
  const steps: FinanceCalcStep[] = []
  const uniqueReserveKeys: string[] = []
  const push = (
    step: Omit<
      FinanceCalcStep,
      | 'order'
      | 'ruleId'
      | 'ruleLineageId'
      | 'ruleVersion'
      | 'valueType'
      | 'basisPoints'
      | 'fixedCents'
      | 'nature'
      | 'recipientId'
      | 'recipientName'
      | 'poolKey'
      | 'poolLabel'
      | 'workType'
      | 'uniqueness'
      | 'note'
    > &
      Partial<FinanceCalcStep>,
  ) => {
    steps.push({
      ruleId: null,
      ruleLineageId: null,
      ruleVersion: null,
      valueType: null,
      basisPoints: null,
      fixedCents: null,
      nature: null,
      recipientId: null,
      recipientName: null,
      poolKey: null,
      poolLabel: null,
      workType: null,
      uniqueness: null,
      note: null,
      ...step,
      order: steps.length + 1,
    })
  }
  const ruleFields = (rule: FinanceEngineRule) => ({
    ruleId: rule.id,
    ruleLineageId: rule.lineageId,
    ruleVersion: rule.version,
    valueType: rule.valueType,
    basisPoints: rule.basisPoints,
    fixedCents: rule.fixedCents,
    nature: rule.nature,
    recipientId: rule.recipientId,
    recipientName: rule.recipientName,
    poolKey: rule.poolKey,
    poolLabel: rule.poolLabel,
    workType: rule.workType || null,
    uniqueness: rule.uniqueness,
  })

  /** Aplica regra percentual (meio-para-cima) ou valor fixo sobre a base. */
  const applyRule = (
    rule: FinanceEngineRule,
    baseKey: FinanceBaseKey,
    baseCents: number,
    code: string,
    kind: FinanceStepKind,
  ): number => {
    if (rule.valueType === 'VALOR_FIXO') {
      const amount = rule.fixedCents as number
      push({
        ...ruleFields(rule),
        code,
        kind,
        description: ruleDisplayName(rule),
        baseKey,
        baseCents,
        formula: `valor fixo ${formatCentsBRL(amount)}`,
        exactCents: `${amount}.0000`,
        rounding: 'NAO_SE_APLICA',
        amountCents: amount,
        isAllocation: true,
      })
      return amount
    }
    const bps = rule.basisPoints as number
    const exact = exactPercentOfCents(baseCents, bps)
    push({
      ...ruleFields(rule),
      code,
      kind,
      description: ruleDisplayName(rule),
      baseKey,
      baseCents,
      formula: `${baseKey} × ${formatBasisPoints(bps)} = ${formatCentsBRL(baseCents)} × ${formatBasisPoints(bps)}`,
      exactCents: exact.exact,
      rounding: exact.remainder === 0 ? 'EXATO' : 'MEIO_PARA_CIMA',
      amountCents: exact.roundedCents,
      isAllocation: true,
    })
    return exact.roundedCents
  }

  const stageRules = (stage: FinanceRuleStage) =>
    applicable.filter((rule) => rule.stage === stage)

  const A = receipt.grossCents
  push({
    code: 'A',
    kind: 'RECEITA_TOTAL',
    description: 'Receita total (valor bruto do recebimento)',
    baseKey: null,
    baseCents: null,
    formula: 'valor do recebimento',
    exactCents: `${A}.0000`,
    rounding: 'EXATO',
    amountCents: A,
    isAllocation: false,
  })

  let B = 0
  stageRules('PROVISAO_RECEITA').forEach((rule, index) => {
    B += applyRule(rule, 'A', A, `B.${index + 1}`, 'PROVISAO_RECEITA')
  })
  push({
    code: 'B',
    kind: 'TOTAL_PROVISOES',
    description: 'Provisões sobre a receita',
    baseKey: 'A',
    baseCents: A,
    formula: 'soma de B.n',
    exactCents: null,
    rounding: 'NAO_SE_APLICA',
    amountCents: B,
    isAllocation: false,
  })

  const C = A - B
  push({
    code: 'C',
    kind: 'RECEITA_LIQUIDA',
    description: 'Receita líquida',
    baseKey: null,
    baseCents: null,
    formula: `A − B = ${formatCentsBRL(A)} − ${formatCentsBRL(B)}`,
    exactCents: null,
    rounding: 'NAO_SE_APLICA',
    amountCents: C,
    isAllocation: false,
  })
  if (C < 0) {
    blocks.push(
      block(
        'RESULTADO_NEGATIVO',
        `Receita líquida negativa (${formatCentsBRL(C)}): as provisões excedem a receita.`,
        'Revise as provisões configuradas.',
        { stage: 'PROVISAO_RECEITA' },
      ),
    )
    return result([], null, [], [])
  }

  let D = 0
  stageRules('DEDUCAO_LIQUIDA').forEach((rule, index) => {
    D += applyRule(rule, 'C', C, `E.${index + 1}`, 'DEDUCAO_LIQUIDA')
  })
  stageRules('RESERVA').forEach((rule, index) => {
    const code = `I.${index + 1}`
    if (rule.uniqueness === 'UNICA_POR_PROCESSO') {
      const key = uniqueReserveKey(rule.poolKey as string, receipt.processId)
      if (input.constitutedUniqueReserves.has(key)) {
        push({
          ...ruleFields(rule),
          code,
          kind: 'RESERVA',
          description: ruleDisplayName(rule),
          baseKey: 'C',
          baseCents: C,
          formula: 'reserva única por processo já constituída',
          exactCents: '0.0000',
          rounding: 'NAO_SE_APLICA',
          amountCents: 0,
          isAllocation: true,
          note: 'Não duplicada: reserva única já constituída para este processo (INV-05).',
        })
        return
      }
      uniqueReserveKeys.push(key)
    }
    D += applyRule(rule, 'C', C, code, 'RESERVA')
  })
  push({
    code: 'D',
    kind: 'TOTAL_DEDUCOES',
    description: 'Total de deduções antes do resultado 1',
    baseKey: 'C',
    baseCents: C,
    formula: 'soma de E.n + I.n',
    exactCents: null,
    rounding: 'NAO_SE_APLICA',
    amountCents: D,
    isAllocation: false,
  })

  const J = C - D
  push({
    code: 'J',
    kind: 'RESULTADO_1',
    description: 'Resultado 1',
    baseKey: null,
    baseCents: null,
    formula: `C − D = ${formatCentsBRL(C)} − ${formatCentsBRL(D)}`,
    exactCents: null,
    rounding: 'NAO_SE_APLICA',
    amountCents: J,
    isAllocation: false,
  })
  if (J < 0) {
    blocks.push(
      block(
        'RESULTADO_NEGATIVO',
        `Resultado 1 negativo (${formatCentsBRL(J)}): deduções excedem a receita líquida.`,
        'Revise deduções e reservas configuradas.',
        { stage: 'DEDUCAO_LIQUIDA' },
      ),
    )
    return result([], null, [], [])
  }

  let L = 0
  stageRules('PARTICIPACAO_RESULTADO').forEach((rule, index) => {
    L += applyRule(rule, 'J', J, `L.${index + 1}`, 'PARTICIPACAO_RESULTADO')
  })
  const M = J - L
  push({
    code: 'M',
    kind: 'RESULTADO_2',
    description: 'Resultado 2',
    baseKey: null,
    baseCents: null,
    formula: `J − L = ${formatCentsBRL(J)} − ${formatCentsBRL(L)}`,
    exactCents: null,
    rounding: 'NAO_SE_APLICA',
    amountCents: M,
    isAllocation: false,
  })
  if (M < 0) {
    blocks.push(
      block(
        'RESULTADO_NEGATIVO',
        `Resultado 2 negativo (${formatCentsBRL(M)}): participações excedem o resultado 1.`,
        'Revise as participações sobre o resultado 1.',
        { stage: 'PARTICIPACAO_RESULTADO' },
      ),
    )
    return result([], null, [], [])
  }

  // Distribuicao final: soma 100% de M. Politica de centavos residuais (V3 §22):
  // truncar cada parcela e entregar os centavos restantes pelo MAIOR RESTO,
  // desempate pela ordem configurada e id da linhagem. Fecha P = 0 exatamente.
  const finalRules = stageRules('DISTRIBUICAO_FINAL')
  const exacts = finalRules.map((rule) =>
    exactPercentOfCents(M, rule.basisPoints as number),
  )
  let residual = M - exacts.reduce((sum, exact) => sum + exact.floorCents, 0)
  const bonus = new Map<number, number>()
  const byRemainder = finalRules
    .map((rule, index) => ({
      rule,
      index,
      remainder: exacts[index]?.remainder ?? 0,
    }))
    .sort((a, b) => b.remainder - a.remainder || compareRules(a.rule, b.rule))
  for (const entry of byRemainder) {
    if (residual <= 0) break
    if (entry.remainder === 0) continue
    bonus.set(entry.index, 1)
    residual -= 1
  }
  let N = 0
  finalRules.forEach((rule, index) => {
    const exact = exacts[index] as ReturnType<typeof exactPercentOfCents>
    const extra = bonus.get(index) ?? 0
    const amount = exact.floorCents + extra
    N += amount
    push({
      ...ruleFields(rule),
      code: `N.${index + 1}`,
      kind: 'DISTRIBUICAO_FINAL',
      description: ruleDisplayName(rule),
      baseKey: 'M',
      baseCents: M,
      formula: `M × ${formatBasisPoints(rule.basisPoints as number)} = ${formatCentsBRL(M)} × ${formatBasisPoints(rule.basisPoints as number)}`,
      exactCents: exact.exact,
      rounding: exact.remainder === 0 ? 'EXATO' : 'MAIOR_RESTO',
      amountCents: amount,
      isAllocation: true,
      note:
        extra > 0
          ? `Centavo residual +R$ 0,01 atribuído por maior resto (${exact.exact} centavos).`
          : null,
    })
  })
  const P = M - N
  push({
    code: 'P',
    kind: 'SALDO_FINAL',
    description: 'Saldo final',
    baseKey: null,
    baseCents: null,
    formula: `M − N = ${formatCentsBRL(M)} − ${formatCentsBRL(N)}`,
    exactCents: null,
    rounding: 'NAO_SE_APLICA',
    amountCents: P,
    isAllocation: false,
  })

  // --- invariantes da memoria (INV-01, INV-09)
  const allocated = steps
    .filter((step) => step.isAllocation)
    .reduce((sum, step) => sum + step.amountCents, 0)
  if (P !== 0 || allocated !== A) {
    blocks.push(
      block(
        'MEMORIA_INCONSISTENTE',
        `Memória inconsistente: saldo final ${formatCentsBRL(P)}, parcelas ${formatCentsBRL(allocated)} para receita ${formatCentsBRL(A)}.`,
        'Revise a configuração; o cálculo não pode ser fechado.',
      ),
    )
    return result([], null, [], [])
  }

  const sumNature = (nature: FinanceRuleNature) =>
    steps
      .filter((step) => step.isAllocation && step.nature === nature)
      .reduce((sum, step) => sum + step.amountCents, 0)

  const totals: FinanceTotals = {
    A,
    B,
    C,
    D,
    J,
    L,
    M,
    N,
    P,
    creditsCents: sumNature('CREDITO'),
    provisionsCents: sumNature('PROVISAO'),
    reservesCents: sumNature('RESERVA'),
  }
  return result(steps, totals, applicable, uniqueReserveKeys)
}

/** Ordem deterministica para "primeiro recebimento" (reserva unica). */
export function compareReceipts(
  a: FinanceReceiptInput,
  b: FinanceReceiptInput,
): number {
  const dateA = a.releaseDate ?? ''
  const dateB = b.releaseDate ?? ''
  if (dateA !== dateB) return dateA < dateB ? -1 : 1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0
}

export type FinanceBatchCalculation = {
  algorithmVersion: string
  receipts: FinanceReceiptCalculation[]
  blocked: boolean
}

/**
 * Calcula um lote em ordem deterministica. A reserva unica constituida por um
 * recebimento vale para os seguintes do mesmo processo (P09 / INV-05).
 */
export function calculateBatch(input: {
  receipts: readonly FinanceReceiptInput[]
  rules: readonly FinanceEngineRule[]
  constitutedUniqueReserves: ReadonlySet<string>
}): FinanceBatchCalculation {
  const constituted = new Set(input.constitutedUniqueReserves)
  const receipts = [...input.receipts].sort(compareReceipts).map((receipt) => {
    const calc = calculateReceipt({
      receipt,
      rules: input.rules,
      constitutedUniqueReserves: constituted,
    })
    for (const key of calc.uniqueReserveKeys) constituted.add(key)
    return calc
  })
  return {
    algorithmVersion: FINANCE_ALGORITHM_VERSION,
    receipts,
    blocked: receipts.some((calc) => calc.blocked),
  }
}

// ---------------------------------------------------------------------------
// Livro de reservas/provisoes (saldo nunca negativo)

export const financeReserveMovementKinds = [
  'CONSTITUICAO',
  'DESPESA',
  'TRANSFERENCIA',
] as const
export type FinanceReserveMovementKind =
  (typeof financeReserveMovementKinds)[number]

export type FinanceReserveMovementInput = {
  kind: FinanceReserveMovementKind
  amountCents: number
  reversed?: boolean
}

export function signedReserveAmount(movement: FinanceReserveMovementInput) {
  if (movement.reversed) return 0
  return movement.kind === 'CONSTITUICAO'
    ? movement.amountCents
    : -movement.amountCents
}

export function reserveBalance(
  movements: readonly FinanceReserveMovementInput[],
): number {
  return movements.reduce((sum, m) => sum + signedReserveAmount(m), 0)
}

/** Debito novo contra o saldo: nunca cria saldo inexistente. */
export function validateReserveDebit(
  currentBalanceCents: number,
  debitCents: number,
): string | null {
  if (!Number.isSafeInteger(debitCents) || debitCents <= 0) {
    return 'O valor deve ser maior que zero.'
  }
  if (debitCents > currentBalanceCents) {
    return `Valor ${formatCentsBRL(debitCents)} excede o saldo disponível ${formatCentsBRL(Math.max(currentBalanceCents, 0))}.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Creditos e baixas

export const financeCreditStatuses = [
  'ABERTO',
  'PARCIALMENTE_PAGO',
  'PAGO',
  'ESTORNADO',
] as const
export type FinanceCreditStatus = (typeof financeCreditStatuses)[number]

/** Estado do credito a partir do devido (original + ajustes) e do pago. */
export function creditStatusFor(
  dueCents: number,
  paidCents: number,
): Exclude<FinanceCreditStatus, 'ESTORNADO'> {
  assertCents(dueCents)
  assertCents(paidCents)
  if (paidCents <= 0) return dueCents === 0 ? 'PAGO' : 'ABERTO'
  return paidCents >= dueCents ? 'PAGO' : 'PARCIALMENTE_PAGO'
}

/** Valida uma baixa (V3 §16): > 0 e acumulado <= devido (INV-06). */
export function validatePayout(
  dueCents: number,
  paidCents: number,
  amountCents: number,
): string | null {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return 'O valor da baixa deve ser maior que zero.'
  }
  const balance = dueCents - paidCents
  if (amountCents > balance) {
    return `Valor ${formatCentsBRL(amountCents)} excede o saldo do crédito ${formatCentsBRL(Math.max(balance, 0))}.`
  }
  return null
}
