import { and, asc, eq, isNotNull, ne, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db'
import { process } from '../processes/processes.schema'
import { loadEngineRules } from './finance.config.service'
import {
  calculateReceipt as calculateEngineReceipt,
  type FinanceEngineRule,
  type FinanceReceiptInput,
  ruleAppliesToComplex,
  ruleAppliesToDate,
} from './finance.engine'
import { constitutedUniqueReserves, toEngineInput } from './finance.receipts.service'
import { financeReceipt } from './finance.schema'
import type { FinanceAccess } from './finance.support'

const PREVIEW_FINAL_PREFIX = '__preview_uncovered__'
const PREVIEW_PROVISION_PREFIX = '__preview_zero_provision__'

export type FinanceCoveragePreview = {
  coveredCents: number
  uncoveredCents: number
  provisionCents: number
  reserveCents: number
  recipientCents: number
  coverageBasisPoints: number
  complete: boolean
  inconsistent: boolean
  pendingReceipts: number
  inconsistentReceipts: number
}

function syntheticRule(input: {
  receipt: FinanceReceiptInput
  stage: 'PROVISAO_RECEITA' | 'DISTRIBUICAO_FINAL'
  basisPoints: number
}): FinanceEngineRule {
  const final = input.stage === 'DISTRIBUICAO_FINAL'
  const prefix = final ? PREVIEW_FINAL_PREFIX : PREVIEW_PROVISION_PREFIX
  const id = `${prefix}:${input.receipt.receiptId}`
  return {
    id,
    lineageId: id,
    version: 1,
    stage: input.stage,
    nature: final ? 'CREDITO' : 'PROVISAO',
    recipientId: final ? PREVIEW_FINAL_PREFIX : null,
    recipientName: final ? 'Saldo ainda sem regra' : null,
    poolKey: final ? null : PREVIEW_PROVISION_PREFIX,
    poolLabel: final ? null : 'Provisão não configurada (prévia)',
    workType: prefix,
    valueType: 'PERCENTUAL',
    basisPoints: input.basisPoints,
    fixedCents: null,
    sortOrder: 2_000_000_000,
    uniqueness: 'NENHUMA',
    validFrom: '1900-01-01',
    validTo: null,
    housingComplexIds: input.receipt.housingComplexId
      ? [input.receipt.housingComplexId]
      : [],
    origin: 'MANUAL',
  }
}

/**
 * Calcula apenas uma PREVIA de cobertura para recebimentos ainda abertos.
 * O motor oficial continua estrito: para fechamento, a distribuicao final deve
 * somar exatamente 100%. Aqui completamos temporariamente o percentual faltante
 * com uma regra sintetica "sem destino" e excluimos essa parcela da cobertura.
 * Assim reaproveitamos as mesmas bases, arredondamentos e reservas do motor sem
 * gerar creditos, fechamentos ou qualquer efeito financeiro.
 */
export async function previewOpenReceiptCoverage(
  access: FinanceAccess,
): Promise<FinanceCoveragePreview> {
  const filters: SQL[] = [
    ne(financeReceipt.status, 'CANCELADO'),
    ne(financeReceipt.status, 'FECHADO'),
    isNotNull(financeReceipt.releaseDate),
  ]
  if (access.processFilter) filters.push(access.processFilter)

  const rows = await db
    .select({
      receipt: financeReceipt,
      housingComplexId: process.housingComplexId,
    })
    .from(financeReceipt)
    .innerJoin(process, eq(financeReceipt.processId, process.id))
    .where(and(...filters))
    .orderBy(
      asc(financeReceipt.releaseDate),
      asc(financeReceipt.createdAt),
      asc(financeReceipt.id),
    )

  if (rows.length === 0) {
    return {
      coveredCents: 0,
      uncoveredCents: 0,
      provisionCents: 0,
      reserveCents: 0,
      recipientCents: 0,
      coverageBasisPoints: 0,
      complete: true,
      inconsistent: false,
      pendingReceipts: 0,
      inconsistentReceipts: 0,
    }
  }

  const rules = await loadEngineRules(db)
  const processIds = [...new Set(rows.map((row) => row.receipt.processId))]
  const constituted = await constitutedUniqueReserves(db, processIds)

  let receivedCents = 0
  let coveredCents = 0
  let provisionCents = 0
  let reserveCents = 0
  let recipientCents = 0
  let inconsistentReceipts = 0

  for (const row of rows) {
    const receipt = toEngineInput(row.receipt, row.housingComplexId)
    receivedCents += receipt.grossCents

    if (!receipt.clientRegistrationDate || !receipt.housingComplexId) {
      inconsistentReceipts += 1
      continue
    }

    const applicable = rules.filter(
      (rule) =>
        ruleAppliesToComplex(rule, receipt.housingComplexId) &&
        ruleAppliesToDate(rule, receipt.clientRegistrationDate as string),
    )
    const finals = applicable.filter(
      (rule) => rule.stage === 'DISTRIBUICAO_FINAL',
    )
    const finalBasisPoints = finals.reduce(
      (sum, rule) => sum + (rule.basisPoints ?? 0),
      0,
    )

    if (finalBasisPoints > 10_000) {
      inconsistentReceipts += 1
      continue
    }

    const previewRules = [...rules]
    const syntheticIds = new Set<string>()

    if (!applicable.some((rule) => rule.stage === 'PROVISAO_RECEITA')) {
      const zeroProvision = syntheticRule({
        receipt,
        stage: 'PROVISAO_RECEITA',
        basisPoints: 0,
      })
      previewRules.push(zeroProvision)
      syntheticIds.add(zeroProvision.id)
    }

    if (finalBasisPoints < 10_000) {
      const uncovered = syntheticRule({
        receipt,
        stage: 'DISTRIBUICAO_FINAL',
        basisPoints: 10_000 - finalBasisPoints,
      })
      previewRules.push(uncovered)
      syntheticIds.add(uncovered.id)
    }

    const calculation = calculateEngineReceipt({
      receipt,
      rules: previewRules,
      constitutedUniqueReserves: constituted,
    })

    if (calculation.blocked || !calculation.totals) {
      inconsistentReceipts += 1
      continue
    }

    for (const key of calculation.uniqueReserveKeys) constituted.add(key)

    for (const step of calculation.steps) {
      if (!step.isAllocation || !step.ruleId || syntheticIds.has(step.ruleId)) {
        continue
      }
      coveredCents += step.amountCents
      if (step.nature === 'PROVISAO') provisionCents += step.amountCents
      else if (step.nature === 'RESERVA') reserveCents += step.amountCents
      else if (step.nature === 'CREDITO') recipientCents += step.amountCents
    }
  }

  const uncoveredCents = Math.max(0, receivedCents - coveredCents)
  const coverageBasisPoints =
    receivedCents > 0
      ? Math.min(10_000, Math.round((coveredCents * 10_000) / receivedCents))
      : 0

  return {
    coveredCents,
    uncoveredCents,
    provisionCents,
    reserveCents,
    recipientCents,
    coverageBasisPoints,
    complete:
      receivedCents > 0 && uncoveredCents === 0 && inconsistentReceipts === 0,
    inconsistent: inconsistentReceipts > 0,
    pendingReceipts: rows.length,
    inconsistentReceipts,
  }
}
