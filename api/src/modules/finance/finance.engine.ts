// Motor PURO de calculo do modulo Pagamentos (sem banco, sem relogio, sem I/O).
// Contrato: docs/pagamentos/CONTRATO.md. Toda mudanca de formula exige nova
// FINANCE_ALGORITHM_VERSION — fechamentos antigos guardam a versao usada.

import {
  assertBasisPoints,
  assertCents,
  formatBasisPoints,
  formatCentsBRL,
  percentOfCents,
} from './finance.money'

export const FINANCE_ALGORITHM_VERSION = 'pagamentos-calc-v1'

export const financeRuleRoles = [
  'PARTICIPACAO',
  'LIDERANCA',
  'PROSPECTADOR',
  'DISTRIBUICAO',
  'DISTRIBUICAO_SALDO',
] as const
export type FinanceRuleRole = (typeof financeRuleRoles)[number]

export const participationRoles: readonly FinanceRuleRole[] = [
  'PARTICIPACAO',
  'LIDERANCA',
  'PROSPECTADOR',
]

export const financeLineRubrics = [
  'TRIBUTO_PROVISIONADO',
  'PARTICIPACAO',
  'PROVISAO_APOIO',
  'RESERVA_CERTIDAO',
  'DISTRIBUICAO',
  'DISTRIBUICAO_SALDO',
] as const
export type FinanceLineRubric = (typeof financeLineRubrics)[number]

/** Rubricas que geram valor DEVIDO a um destinatario (entram no extrato/baixa). */
export const payableRubrics: readonly FinanceLineRubric[] = [
  'PARTICIPACAO',
  'DISTRIBUICAO',
  'DISTRIBUICAO_SALDO',
]

export type FinanceEngineConfig = {
  taxProvisionBps: number
  supportProvisionBps: number
  certidaoReserveCents: number
}

export const DEFAULT_FINANCE_CONFIG: FinanceEngineConfig = {
  taxProvisionBps: 2000,
  supportProvisionBps: 400,
  certidaoReserveCents: 50_000,
}

export type FinanceEngineRule = {
  id: string
  revision: number
  recipientId: string
  recipientName: string
  role: FinanceRuleRole
  /** null = vale para todos os conjuntos */
  housingComplexId: string | null
  /** YYYY-MM-DD, inclusivo */
  validFrom: string
  /** YYYY-MM-DD, inclusivo; null = vigencia aberta */
  validTo: string | null
  /** null apenas para DISTRIBUICAO_SALDO */
  basisPoints: number | null
  /** ordem na cascata (DISTRIBUICAO); null para os demais papeis */
  cascadeOrder: number | null
}

export type FinanceReceiptInput = {
  receiptId: string
  processId: string
  housingComplexId: string | null
  grossCents: number
  /** Data de cadastro de referencia do processo (YYYY-MM-DD) */
  participationReferenceDate: string
  /** Data de liberacao do recebimento (YYYY-MM-DD) — referencia da cascata */
  distributionReferenceDate: string
  /** Alerta informativo vindo de fora (ex.: rascunho, data informada) */
  referenceDateAmbiguous?: boolean
  /** Desempate deterministico da reserva de certidao (ISO) */
  createdAt: string
}

export type FinanceCalcLine = {
  sequence: number
  rubric: FinanceLineRubric
  recipientId: string | null
  recipientName: string | null
  ruleId: string | null
  ruleRevision: number | null
  basisPoints: number | null
  basisCents: number
  amountCents: number
  description: string
}

export type FinanceAlertCode =
  | 'BASE_NEGATIVA'
  | 'SEM_REGRA_SALDO'
  | 'REGRA_SALDO_DUPLICADA'
  | 'ORDEM_CASCATA_DUPLICADA'
  | 'PARTICIPACAO_DUPLICADA'
  | 'VALOR_INVALIDO'
  | 'DATA_REFERENCIA_AMBIGUA'
  | 'PROCESSO_SEM_CONJUNTO'

export type FinanceAlert = {
  code: FinanceAlertCode
  blocking: boolean
  message: string
}

export type FinanceReceiptCalculation = {
  algorithmVersion: string
  receiptId: string
  processId: string
  housingComplexId: string | null
  grossCents: number
  taxProvisionCents: number
  netCents: number
  participationsCents: number
  supportProvisionCents: number
  certidaoReserveCents: number
  distributableBaseCents: number
  distributionCents: number
  lines: FinanceCalcLine[]
  alerts: FinanceAlert[]
  blocked: boolean
  /** Regras efetivamente usadas (copia integral, para snapshot). */
  rulesUsed: FinanceEngineRule[]
  memory: string[]
}

export function ruleAppliesTo(
  rule: FinanceEngineRule,
  housingComplexId: string | null,
  date: string,
): boolean {
  if (
    rule.housingComplexId !== null &&
    rule.housingComplexId !== housingComplexId
  ) {
    return false
  }
  if (date < rule.validFrom) return false
  if (rule.validTo !== null && date > rule.validTo) return false
  return true
}

function blockingAlert(code: FinanceAlertCode, message: string): FinanceAlert {
  return { code, blocking: true, message }
}

/**
 * Calcula UM recebimento. `appliesCertidaoReserve` e decidido fora (por processo,
 * no lote) — ver assignCertidaoReserves.
 */
export function calculateReceipt(input: {
  receipt: FinanceReceiptInput
  rules: readonly FinanceEngineRule[]
  appliesCertidaoReserve: boolean
  config?: FinanceEngineConfig
}): FinanceReceiptCalculation {
  const config = input.config ?? DEFAULT_FINANCE_CONFIG
  const { receipt } = input
  const alerts: FinanceAlert[] = []
  const memory: string[] = []
  const lines: FinanceCalcLine[] = []

  const empty = (): FinanceReceiptCalculation => ({
    algorithmVersion: FINANCE_ALGORITHM_VERSION,
    receiptId: receipt.receiptId,
    processId: receipt.processId,
    housingComplexId: receipt.housingComplexId,
    grossCents: receipt.grossCents,
    taxProvisionCents: 0,
    netCents: 0,
    participationsCents: 0,
    supportProvisionCents: 0,
    certidaoReserveCents: 0,
    distributableBaseCents: 0,
    distributionCents: 0,
    lines: [],
    alerts,
    blocked: true,
    rulesUsed: [],
    memory,
  })

  if (!Number.isSafeInteger(receipt.grossCents) || receipt.grossCents <= 0) {
    alerts.push(
      blockingAlert('VALOR_INVALIDO', 'O valor bruto deve ser maior que zero.'),
    )
    return empty()
  }
  assertBasisPoints(config.taxProvisionBps, 'tributo provisionado')
  assertBasisPoints(config.supportProvisionBps, 'provisao de apoio')
  assertCents(config.certidaoReserveCents, 'reserva de certidao')

  if (receipt.referenceDateAmbiguous) {
    alerts.push({
      code: 'DATA_REFERENCIA_AMBIGUA',
      blocking: false,
      message: `Data de cadastro de referencia ${receipt.participationReferenceDate} precisa de validacao (rascunho, importacao ou data informada).`,
    })
  }
  if (receipt.housingComplexId === null) {
    alerts.push({
      code: 'PROCESSO_SEM_CONJUNTO',
      blocking: false,
      message:
        'Processo sem conjunto: apenas regras gerais foram consideradas.',
    })
  }

  const participationRules = input.rules
    .filter((rule) => participationRoles.includes(rule.role))
    .filter((rule) =>
      ruleAppliesTo(
        rule,
        receipt.housingComplexId,
        receipt.participationReferenceDate,
      ),
    )
    .sort(compareRules)

  const cascadeRules = input.rules
    .filter(
      (rule) =>
        rule.role === 'DISTRIBUICAO' || rule.role === 'DISTRIBUICAO_SALDO',
    )
    .filter((rule) =>
      ruleAppliesTo(
        rule,
        receipt.housingComplexId,
        receipt.distributionReferenceDate,
      ),
    )
    .sort(compareRules)

  // Ambiguidades que a publicacao deveria ter barrado — o motor nunca escolhe.
  const participationKeys = new Set<string>()
  for (const rule of participationRules) {
    const key = `${rule.recipientId}|${rule.role}`
    if (participationKeys.has(key)) {
      alerts.push(
        blockingAlert(
          'PARTICIPACAO_DUPLICADA',
          `${rule.recipientName} tem mais de uma regra de ${rule.role} aplicavel.`,
        ),
      )
    }
    participationKeys.add(key)
  }
  const steps = cascadeRules.filter((rule) => rule.role === 'DISTRIBUICAO')
  const remainderRules = cascadeRules.filter(
    (rule) => rule.role === 'DISTRIBUICAO_SALDO',
  )
  const orders = new Set<number>()
  for (const step of steps) {
    const order = step.cascadeOrder ?? -1
    if (orders.has(order)) {
      alerts.push(
        blockingAlert(
          'ORDEM_CASCATA_DUPLICADA',
          `Mais de uma regra de distribuicao aplicavel na ordem ${order}.`,
        ),
      )
    }
    orders.add(order)
  }
  if (remainderRules.length === 0) {
    alerts.push(
      blockingAlert(
        'SEM_REGRA_SALDO',
        'Nenhuma regra de saldo final aplicavel ao conjunto/data.',
      ),
    )
  } else if (remainderRules.length > 1) {
    alerts.push(
      blockingAlert(
        'REGRA_SALDO_DUPLICADA',
        'Mais de uma regra de saldo final aplicavel ao conjunto/data.',
      ),
    )
  }
  if (alerts.some((alert) => alert.blocking)) {
    return empty()
  }

  let sequence = 0
  const pushLine = (line: Omit<FinanceCalcLine, 'sequence'>) => {
    sequence += 1
    lines.push({ ...line, sequence })
  }

  const gross = receipt.grossCents
  const tax = percentOfCents(gross, config.taxProvisionBps)
  const net = gross - tax
  memory.push(`Bruto elegivel = ${formatCentsBRL(gross)}`)
  memory.push(
    `Tributo provisionado = ${formatBasisPoints(config.taxProvisionBps)} x ${formatCentsBRL(gross)} = ${formatCentsBRL(tax)}`,
  )
  memory.push(
    `Receita liquida = ${formatCentsBRL(gross)} - ${formatCentsBRL(tax)} = ${formatCentsBRL(net)}`,
  )
  pushLine({
    rubric: 'TRIBUTO_PROVISIONADO',
    recipientId: null,
    recipientName: null,
    ruleId: null,
    ruleRevision: null,
    basisPoints: config.taxProvisionBps,
    basisCents: gross,
    amountCents: tax,
    description: 'Tributo provisionado sobre o bruto',
  })

  let participations = 0
  for (const rule of participationRules) {
    const bps = rule.basisPoints ?? 0
    const amount = percentOfCents(net, bps)
    participations += amount
    memory.push(
      `${labelForRole(rule.role)} ${rule.recipientName} (regra ${rule.id} r${rule.revision}, ref. ${receipt.participationReferenceDate}) = ${formatBasisPoints(bps)} x ${formatCentsBRL(net)} = ${formatCentsBRL(amount)}`,
    )
    pushLine({
      rubric: 'PARTICIPACAO',
      recipientId: rule.recipientId,
      recipientName: rule.recipientName,
      ruleId: rule.id,
      ruleRevision: rule.revision,
      basisPoints: bps,
      basisCents: net,
      amountCents: amount,
      description: `${labelForRole(rule.role)} sobre o liquido`,
    })
  }
  if (participationRules.length === 0) {
    memory.push('Participacoes profissionais aplicaveis: nenhuma (R$ 0,00)')
  }

  const support = percentOfCents(net, config.supportProvisionBps)
  memory.push(
    `Provisao de apoio/prospeccao = ${formatBasisPoints(config.supportProvisionBps)} x ${formatCentsBRL(net)} = ${formatCentsBRL(support)}`,
  )
  pushLine({
    rubric: 'PROVISAO_APOIO',
    recipientId: null,
    recipientName: null,
    ruleId: null,
    ruleRevision: null,
    basisPoints: config.supportProvisionBps,
    basisCents: net,
    amountCents: support,
    description: 'Provisao de apoio/prospeccao (segregada)',
  })

  const reserve = input.appliesCertidaoReserve ? config.certidaoReserveCents : 0
  memory.push(
    input.appliesCertidaoReserve
      ? `Reserva de certidao (1o recebimento elegivel do processo) = ${formatCentsBRL(reserve)}`
      : 'Reserva de certidao = R$ 0,00 (ja constituida para o processo)',
  )
  pushLine({
    rubric: 'RESERVA_CERTIDAO',
    recipientId: null,
    recipientName: null,
    ruleId: null,
    ruleRevision: null,
    basisPoints: null,
    basisCents: reserve,
    amountCents: reserve,
    description: input.appliesCertidaoReserve
      ? 'Reserva unica de certidao do processo'
      : 'Reserva de certidao ja constituida',
  })

  const base = net - participations - support - reserve
  memory.push(
    `Base distribuivel = ${formatCentsBRL(net)} - ${formatCentsBRL(participations)} - ${formatCentsBRL(support)} - ${formatCentsBRL(reserve)} = ${formatCentsBRL(base)}`,
  )
  if (base < 0) {
    alerts.push(
      blockingAlert(
        'BASE_NEGATIVA',
        `Base distribuivel negativa (${formatCentsBRL(base)}): revise as regras antes de conferir.`,
      ),
    )
    return { ...empty(), memory }
  }

  let remaining = base
  let distribution = 0
  for (const step of steps) {
    const bps = step.basisPoints ?? 0
    const amount = percentOfCents(remaining, bps)
    memory.push(
      `Cascata ${step.cascadeOrder}: ${step.recipientName} (regra ${step.id} r${step.revision}) = ${formatBasisPoints(bps)} x ${formatCentsBRL(remaining)} = ${formatCentsBRL(amount)}`,
    )
    pushLine({
      rubric: 'DISTRIBUICAO',
      recipientId: step.recipientId,
      recipientName: step.recipientName,
      ruleId: step.id,
      ruleRevision: step.revision,
      basisPoints: bps,
      basisCents: remaining,
      amountCents: amount,
      description: `Distribuicao (ordem ${step.cascadeOrder})`,
    })
    remaining -= amount
    distribution += amount
  }
  const remainderRule = remainderRules[0] as FinanceEngineRule
  memory.push(
    `Saldo final: ${remainderRule.recipientName} (regra ${remainderRule.id} r${remainderRule.revision}) = ${formatCentsBRL(remaining)}`,
  )
  pushLine({
    rubric: 'DISTRIBUICAO_SALDO',
    recipientId: remainderRule.recipientId,
    recipientName: remainderRule.recipientName,
    ruleId: remainderRule.id,
    ruleRevision: remainderRule.revision,
    basisPoints: null,
    basisCents: remaining,
    amountCents: remaining,
    description: 'Saldo final da distribuicao',
  })
  distribution += remaining

  const total = lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (total !== gross) {
    // Erro de programacao: nunca deve acontecer. Falha alto em vez de gravar.
    throw new Error(
      `Invariante violado: soma das linhas ${total} != bruto ${gross} (${receipt.receiptId})`,
    )
  }
  memory.push(
    `Conferencia: ${formatCentsBRL(tax)} + ${formatCentsBRL(participations)} + ${formatCentsBRL(support)} + ${formatCentsBRL(reserve)} + ${formatCentsBRL(distribution)} = ${formatCentsBRL(total)} (bruto)`,
  )

  return {
    algorithmVersion: FINANCE_ALGORITHM_VERSION,
    receiptId: receipt.receiptId,
    processId: receipt.processId,
    housingComplexId: receipt.housingComplexId,
    grossCents: gross,
    taxProvisionCents: tax,
    netCents: net,
    participationsCents: participations,
    supportProvisionCents: support,
    certidaoReserveCents: reserve,
    distributableBaseCents: base,
    distributionCents: distribution,
    lines,
    alerts,
    blocked: false,
    rulesUsed: [...participationRules, ...steps, remainderRule],
    memory,
  }
}

function compareRules(a: FinanceEngineRule, b: FinanceEngineRule): number {
  const orderA = a.cascadeOrder ?? 0
  const orderB = b.cascadeOrder ?? 0
  if (orderA !== orderB) return orderA - orderB
  if (a.role !== b.role) return a.role < b.role ? -1 : 1
  if (a.recipientName !== b.recipientName) {
    return a.recipientName < b.recipientName ? -1 : 1
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function labelForRole(role: FinanceRuleRole): string {
  switch (role) {
    case 'PARTICIPACAO':
      return 'Participacao'
    case 'LIDERANCA':
      return 'Lideranca'
    case 'PROSPECTADOR':
      return 'Prospectador'
    case 'DISTRIBUICAO':
      return 'Distribuicao'
    case 'DISTRIBUICAO_SALDO':
      return 'Saldo final'
  }
}

/** Ordem deterministica para "primeiro recebimento elegivel do processo". */
export function compareReceiptsForReserve(
  a: FinanceReceiptInput,
  b: FinanceReceiptInput,
): number {
  if (a.distributionReferenceDate !== b.distributionReferenceDate) {
    return a.distributionReferenceDate < b.distributionReferenceDate ? -1 : 1
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0
}

/**
 * Decide quais recebimentos constituem a reserva de certidao: o PRIMEIRO de cada
 * processo que ainda nao tem reserva constituida. Retorna o conjunto de receiptIds.
 */
export function assignCertidaoReserves(
  receipts: readonly FinanceReceiptInput[],
  processIdsWithReserve: ReadonlySet<string>,
): Set<string> {
  const taken = new Set(processIdsWithReserve)
  const result = new Set<string>()
  for (const receipt of [...receipts].sort(compareReceiptsForReserve)) {
    if (taken.has(receipt.processId)) continue
    taken.add(receipt.processId)
    result.add(receipt.receiptId)
  }
  return result
}

export type FinanceBatchCalculation = {
  algorithmVersion: string
  receipts: FinanceReceiptCalculation[]
  blocked: boolean
  totals: FinanceTotals
  rulesUsed: FinanceEngineRule[]
}

export type FinanceTotals = {
  grossCents: number
  taxProvisionCents: number
  netCents: number
  participationsCents: number
  supportProvisionCents: number
  certidaoReserveCents: number
  distributableBaseCents: number
  distributionCents: number
  byRecipient: Array<{
    recipientId: string
    recipientName: string
    amountCents: number
  }>
}

/** Calcula um lote (previa de fechamento ou fechamento). */
export function calculateBatch(input: {
  receipts: readonly FinanceReceiptInput[]
  rules: readonly FinanceEngineRule[]
  processIdsWithReserve: ReadonlySet<string>
  config?: FinanceEngineConfig
}): FinanceBatchCalculation {
  const ordered = [...input.receipts].sort(compareReceiptsForReserve)
  const reserveReceipts = assignCertidaoReserves(
    ordered,
    input.processIdsWithReserve,
  )
  const calculations = ordered.map((receipt) =>
    calculateReceipt({
      receipt,
      rules: input.rules,
      appliesCertidaoReserve: reserveReceipts.has(receipt.receiptId),
      config: input.config,
    }),
  )

  const rulesUsed = new Map<string, FinanceEngineRule>()
  for (const calc of calculations) {
    for (const rule of calc.rulesUsed) rulesUsed.set(rule.id, rule)
  }

  return {
    algorithmVersion: FINANCE_ALGORITHM_VERSION,
    receipts: calculations,
    blocked: calculations.some((calc) => calc.blocked),
    totals: sumCalculations(calculations),
    rulesUsed: [...rulesUsed.values()].sort(compareRules),
  }
}

export function sumCalculations(
  calculations: readonly FinanceReceiptCalculation[],
): FinanceTotals {
  const byRecipient = new Map<
    string,
    { recipientId: string; recipientName: string; amountCents: number }
  >()
  const totals: FinanceTotals = {
    grossCents: 0,
    taxProvisionCents: 0,
    netCents: 0,
    participationsCents: 0,
    supportProvisionCents: 0,
    certidaoReserveCents: 0,
    distributableBaseCents: 0,
    distributionCents: 0,
    byRecipient: [],
  }
  for (const calc of calculations) {
    if (calc.blocked) continue
    totals.grossCents += calc.grossCents
    totals.taxProvisionCents += calc.taxProvisionCents
    totals.netCents += calc.netCents
    totals.participationsCents += calc.participationsCents
    totals.supportProvisionCents += calc.supportProvisionCents
    totals.certidaoReserveCents += calc.certidaoReserveCents
    totals.distributableBaseCents += calc.distributableBaseCents
    totals.distributionCents += calc.distributionCents
    for (const line of calc.lines) {
      if (!line.recipientId || !payableRubrics.includes(line.rubric)) continue
      const current = byRecipient.get(line.recipientId) ?? {
        recipientId: line.recipientId,
        recipientName: line.recipientName ?? '',
        amountCents: 0,
      }
      current.amountCents += line.amountCents
      byRecipient.set(line.recipientId, current)
    }
  }
  totals.byRecipient = [...byRecipient.values()].sort((a, b) =>
    a.recipientName.localeCompare(b.recipientName, 'pt-BR'),
  )
  return totals
}

// ---------------------------------------------------------------------------
// Conflito de regras (publicacao)

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

function scopesOverlap(a: string | null, b: string | null): boolean {
  return a === null || b === null || a === b
}

/** Valida a forma de uma regra isolada. Retorna mensagens de erro (pt-BR). */
export function validateRuleShape(rule: FinanceEngineRule): string[] {
  const errors: string[] = []
  if (rule.validTo !== null && rule.validTo < rule.validFrom) {
    errors.push('O fim da vigencia deve ser igual ou posterior ao inicio.')
  }
  if (rule.role === 'DISTRIBUICAO_SALDO') {
    if (rule.basisPoints !== null) {
      errors.push('A regra de saldo final nao usa percentual.')
    }
  } else if (
    rule.basisPoints === null ||
    !Number.isInteger(rule.basisPoints) ||
    rule.basisPoints <= 0 ||
    rule.basisPoints > 10_000
  ) {
    errors.push('Percentual deve estar entre 0,01% e 100,00%.')
  }
  if (rule.role === 'DISTRIBUICAO') {
    if (
      rule.cascadeOrder === null ||
      !Number.isInteger(rule.cascadeOrder) ||
      rule.cascadeOrder < 1
    ) {
      errors.push('Regra de distribuicao exige ordem inteira a partir de 1.')
    }
  } else if (rule.cascadeOrder !== null) {
    errors.push('Somente regras de distribuicao possuem ordem na cascata.')
  }
  return errors
}

/**
 * Conflitos de `candidate` contra regras ja publicadas. Sobreposicao de escopo
 * (conjunto igual ou "todos") + vigencia = ambiguidade: especificidade nao decide.
 */
export function findRuleConflicts(
  candidate: FinanceEngineRule,
  published: readonly FinanceEngineRule[],
): FinanceRuleConflict[] {
  const conflicts: FinanceRuleConflict[] = []
  for (const other of published) {
    if (other.id === candidate.id) continue
    if (!scopesOverlap(candidate.housingComplexId, other.housingComplexId)) {
      continue
    }
    if (!rangesOverlap(candidate, other)) continue

    let message: string | null = null
    if (
      participationRoles.includes(candidate.role) &&
      candidate.role === other.role &&
      candidate.recipientId === other.recipientId
    ) {
      message = `${other.recipientName} ja possui regra de ${labelForRole(other.role)} com vigencia e conjunto sobrepostos.`
    } else if (
      candidate.role === 'DISTRIBUICAO' &&
      other.role === 'DISTRIBUICAO' &&
      candidate.cascadeOrder === other.cascadeOrder
    ) {
      message = `Ja existe distribuicao na ordem ${other.cascadeOrder} (${other.recipientName}) com vigencia e conjunto sobrepostos.`
    } else if (
      candidate.role === 'DISTRIBUICAO_SALDO' &&
      other.role === 'DISTRIBUICAO_SALDO'
    ) {
      message = `Ja existe regra de saldo final (${other.recipientName}) com vigencia e conjunto sobrepostos.`
    }
    if (message) {
      conflicts.push({
        ruleId: candidate.id,
        conflictingRuleId: other.id,
        message,
      })
    }
  }
  return conflicts
}

// ---------------------------------------------------------------------------
// Livro de reservas/provisoes (saldo nunca negativo)

export const financeReservePools = ['CERTIDAO', 'TRIBUTO', 'APOIO'] as const
export type FinanceReservePool = (typeof financeReservePools)[number]

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
  /** Movimento estornado nao conta no saldo. */
  reversed?: boolean
}

export function signedReserveAmount(
  movement: FinanceReserveMovementInput,
): number {
  if (movement.reversed) return 0
  return movement.kind === 'CONSTITUICAO'
    ? movement.amountCents
    : -movement.amountCents
}

export function reserveBalance(
  movements: readonly FinanceReserveMovementInput[],
): number {
  return movements.reduce(
    (sum, movement) => sum + signedReserveAmount(movement),
    0,
  )
}

/**
 * Valida um DEBITO novo contra o saldo corrente. Retorna mensagem de erro ou null.
 * Nunca permite saldo negativo ("sem criar saldo inexistente").
 */
export function validateReserveDebit(
  currentBalanceCents: number,
  debitCents: number,
): string | null {
  if (!Number.isSafeInteger(debitCents) || debitCents <= 0) {
    return 'O valor deve ser maior que zero.'
  }
  if (debitCents > currentBalanceCents) {
    return `Valor ${formatCentsBRL(debitCents)} excede o saldo disponivel ${formatCentsBRL(Math.max(currentBalanceCents, 0))}.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Baixas (pagamentos feitos FORA da plataforma): alocacao FIFO nas linhas devidas

export type FinancePayableItem = {
  lineId: string
  /** devido - ja pago (baixas ativas) */
  outstandingCents: number
}

export type FinancePayoutAllocation = { lineId: string; amountCents: number }

/**
 * Aloca `amountCents` nas linhas em aberto NA ORDEM recebida (o chamador ordena:
 * fechamento mais antigo, depois sequencia). Nunca aloca acima do saldo devido.
 */
export function allocatePayout(
  items: readonly FinancePayableItem[],
  amountCents: number,
):
  | { ok: true; allocations: FinancePayoutAllocation[] }
  | { ok: false; message: string } {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, message: 'O valor da baixa deve ser maior que zero.' }
  }
  const outstanding = items.reduce(
    (sum, item) => sum + Math.max(item.outstandingCents, 0),
    0,
  )
  if (amountCents > outstanding) {
    return {
      ok: false,
      message: `Valor ${formatCentsBRL(amountCents)} excede o saldo a pagar ${formatCentsBRL(outstanding)}.`,
    }
  }
  const allocations: FinancePayoutAllocation[] = []
  let remaining = amountCents
  for (const item of items) {
    if (remaining === 0) break
    if (item.outstandingCents <= 0) continue
    const amount = Math.min(item.outstandingCents, remaining)
    allocations.push({ lineId: item.lineId, amountCents: amount })
    remaining -= amount
  }
  return { ok: true, allocations }
}
