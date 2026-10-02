import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import {
  type FinanceConfigOrigin,
  type FinanceEngineRule,
  type FinanceRuleNature,
  type FinanceRuleStage,
  type FinanceUniquenessPolicy,
  type FinanceValueType,
  findRuleConflicts,
  normalizePoolKey,
  validateRuleShape,
} from './finance.engine'
import {
  financeRecipient,
  financeRule,
  financeRuleHousingComplex,
} from './finance.schema'
import {
  assertFinance,
  type FinanceAccess,
  type FinanceDb,
  FinanceServiceError,
  type FinanceTx,
  mapDbError,
  previousCivilDate,
  todaySaoPaulo,
  writeAudit,
} from './finance.support'

// Serializa publicacoes de regras: a checagem de sobreposicao e a insercao
// acontecem sob esta trava, evitando duas regras conflitantes concorrentes.
const RULES_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('finance_rules'))`

export function normalizeDocument(value: string | undefined | null): string {
  return (value ?? '').replace(/\D/g, '')
}

// ---------------------------------------------------------------------------
// Recebedores

export type RecipientInput = {
  name: string
  kind: 'PESSOA_FISICA' | 'PESSOA_JURIDICA'
  document?: string
  paymentNote?: string
  notes?: string
}

export async function listRecipients(access: FinanceAccess) {
  assertFinance(access, 'regras', { global: true })
  return db
    .select()
    .from(financeRecipient)
    .orderBy(asc(financeRecipient.name), asc(financeRecipient.id))
}

export async function insertRecipient(
  tx: FinanceDb,
  access: FinanceAccess,
  input: RecipientInput,
  origin: FinanceConfigOrigin = 'MANUAL',
  importBatchId: string | null = null,
) {
  const values = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    kind: input.kind,
    document: normalizeDocument(input.document),
    paymentNote: input.paymentNote?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
    origin,
    importBatchId,
    createdByUserId: access.actor.id,
  }
  const [created] = await tx.insert(financeRecipient).values(values).returning()
  await writeAudit(tx, {
    actor: access.actor,
    entityType: 'recipient',
    entityId: values.id,
    action: 'CRIADO',
    after: created,
  })
  return created
}

export async function createRecipient(
  access: FinanceAccess,
  input: RecipientInput,
) {
  assertFinance(access, 'regras', { global: true })
  try {
    return await db.transaction((tx) => insertRecipient(tx, access, input))
  } catch (error) {
    mapDbError(error, 'Já existe um recebedor com este documento.')
  }
}

export async function updateRecipient(
  access: FinanceAccess,
  recipientId: string,
  input: Partial<RecipientInput> & { isActive?: boolean },
) {
  assertFinance(access, 'regras', { global: true })
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(financeRecipient)
        .where(eq(financeRecipient.id, recipientId))
        .for('update')
      if (!before) {
        throw new FinanceServiceError(404, 'Recebedor não encontrado.')
      }
      if (input.isActive === false && before.isActive) {
        const today = todaySaoPaulo()
        const [activeRule] = await tx
          .select({ id: financeRule.id })
          .from(financeRule)
          .where(
            and(
              eq(financeRule.recipientId, recipientId),
              eq(financeRule.status, 'ATIVA'),
              or(isNull(financeRule.validTo), gte(financeRule.validTo, today)),
            ),
          )
          .limit(1)
        if (activeRule) {
          throw new FinanceServiceError(
            409,
            'Recebedor possui regra vigente ou futura. Remova/desative as regras antes de inativá-lo.',
          )
        }
      }
      const [after] = await tx
        .update(financeRecipient)
        .set({
          name: input.name?.trim() ?? before.name,
          kind: input.kind ?? before.kind,
          document:
            input.document !== undefined
              ? normalizeDocument(input.document)
              : before.document,
          paymentNote: input.paymentNote?.trim() ?? before.paymentNote,
          notes: input.notes?.trim() ?? before.notes,
          isActive: input.isActive ?? before.isActive,
        })
        .where(eq(financeRecipient.id, recipientId))
        .returning()
      await writeAudit(tx, {
        actor: access.actor,
        entityType: 'recipient',
        entityId: recipientId,
        action: 'ALTERADO',
        before,
        after,
      })
      return after
    })
  } catch (error) {
    mapDbError(error, 'Já existe um recebedor com este documento.')
  }
}

// ---------------------------------------------------------------------------
// Regras

export type RuleInput = {
  stage: FinanceRuleStage
  nature: FinanceRuleNature
  recipientId?: string | null
  poolLabel?: string | null
  workType?: string
  valueType: FinanceValueType
  /** null = nao configurado; 0 = 0% configurado */
  basisPoints?: number | null
  fixedCents?: number | null
  sortOrder?: number
  uniqueness?: FinanceUniquenessPolicy
  validFrom: string
  validTo?: string | null
  /** vazio = escopo global (todos os processos com condominio) */
  housingComplexIds: string[]
  notes?: string
}

type RuleRow = typeof financeRule.$inferSelect

/** Carrega versoes ATIVAS no formato do motor (com condominios e nomes). */
export async function loadEngineRules(
  tx: FinanceDb = db,
): Promise<FinanceEngineRule[]> {
  const rows = await tx
    .select({ rule: financeRule, recipientName: financeRecipient.name })
    .from(financeRule)
    .leftJoin(
      financeRecipient,
      eq(financeRule.recipientId, financeRecipient.id),
    )
    .where(eq(financeRule.status, 'ATIVA'))
  if (rows.length === 0) return []
  const complexes = await tx
    .select()
    .from(financeRuleHousingComplex)
    .where(
      inArray(
        financeRuleHousingComplex.ruleId,
        rows.map((row) => row.rule.id),
      ),
    )
  const byRule = new Map<string, string[]>()
  for (const link of complexes) {
    const list = byRule.get(link.ruleId) ?? []
    list.push(link.housingComplexId)
    byRule.set(link.ruleId, list)
  }
  return rows.map(({ rule, recipientName }) =>
    toEngineRule(rule, recipientName, byRule.get(rule.id) ?? []),
  )
}

export function toEngineRule(
  rule: RuleRow,
  recipientName: string | null,
  housingComplexIds: string[],
): FinanceEngineRule {
  return {
    id: rule.id,
    lineageId: rule.lineageId,
    version: rule.version,
    stage: rule.stage,
    nature: rule.nature,
    recipientId: rule.recipientId,
    recipientName,
    poolKey: rule.poolKey,
    poolLabel: rule.poolLabel,
    workType: rule.workType,
    valueType: rule.valueType,
    basisPoints: rule.basisPoints,
    fixedCents: rule.fixedCents,
    sortOrder: rule.sortOrder,
    uniqueness: rule.uniqueness,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
    housingComplexIds: [...housingComplexIds].sort(),
    origin: rule.origin,
  }
}

function buildCandidate(
  input: RuleInput,
  ids: { id: string; lineageId: string; version: number },
  recipientName: string | null,
  origin: FinanceConfigOrigin,
): FinanceEngineRule {
  const poolLabel =
    input.nature === 'CREDITO' ? null : (input.poolLabel?.trim() ?? null)
  return {
    id: ids.id,
    lineageId: ids.lineageId,
    version: ids.version,
    stage: input.stage,
    nature: input.nature,
    recipientId:
      input.nature === 'CREDITO' ? (input.recipientId ?? null) : null,
    recipientName,
    poolKey: poolLabel ? normalizePoolKey(poolLabel) || null : null,
    poolLabel: poolLabel || null,
    workType: input.workType?.trim() ?? '',
    valueType: input.valueType,
    basisPoints:
      input.valueType === 'PERCENTUAL' ? (input.basisPoints ?? null) : null,
    fixedCents:
      input.valueType === 'VALOR_FIXO' ? (input.fixedCents ?? null) : null,
    sortOrder: input.sortOrder ?? 0,
    uniqueness: input.uniqueness ?? 'NENHUMA',
    validFrom: input.validFrom,
    validTo: input.validTo ?? null,
    housingComplexIds: [...new Set(input.housingComplexIds)].sort(),
    origin,
  }
}

async function assertRuleReferences(
  tx: FinanceDb,
  candidate: FinanceEngineRule,
): Promise<void> {
  if (candidate.recipientId) {
    const [recipient] = await tx
      .select({ id: financeRecipient.id, isActive: financeRecipient.isActive })
      .from(financeRecipient)
      .where(eq(financeRecipient.id, candidate.recipientId))
    if (!recipient) {
      throw new FinanceServiceError(422, 'Recebedor não encontrado.')
    }
    if (!recipient.isActive) {
      throw new FinanceServiceError(422, 'Recebedor inativo.')
    }
  }
  const complexes = await tx
    .select({ id: housingComplex.id })
    .from(housingComplex)
    .where(inArray(housingComplex.id, [...candidate.housingComplexIds, '']))
  if (complexes.length !== candidate.housingComplexIds.length) {
    throw new FinanceServiceError(422, 'Condomínio não encontrado.')
  }
}

/**
 * Valida e grava uma versao de regra dentro de `tx` (ja sob RULES_LOCK).
 * Compartilhado pelo cadastro manual e pela importacao (INV-10).
 */
export async function insertRuleVersion(
  tx: FinanceTx,
  access: FinanceAccess,
  input: RuleInput,
  options: {
    lineageId?: string
    version?: number
    origin?: FinanceConfigOrigin
    importBatchId?: string | null
    ignoreLineageId?: string
    recipientName?: string | null
    activeRules?: FinanceEngineRule[]
  } = {},
): Promise<FinanceEngineRule> {
  const id = crypto.randomUUID()
  const candidate = buildCandidate(
    input,
    {
      id,
      lineageId: options.lineageId ?? id,
      version: options.version ?? 1,
    },
    options.recipientName ?? null,
    options.origin ?? 'MANUAL',
  )
  const shapeErrors = validateRuleShape(candidate)
  if (shapeErrors.length > 0) {
    throw new FinanceServiceError(422, shapeErrors.join(' '))
  }
  await assertRuleReferences(tx, candidate)
  const active = options.activeRules ?? (await loadEngineRules(tx))
  const conflicts = findRuleConflicts(
    candidate,
    active,
    options.ignoreLineageId,
  )
  if (conflicts.length > 0) {
    throw new FinanceServiceError(
      409,
      `Sobreposição de vigência: ${conflicts.map((c) => c.message).join(' ')}`,
    )
  }
  await tx.insert(financeRule).values({
    id,
    lineageId: candidate.lineageId,
    version: candidate.version,
    stage: candidate.stage,
    nature: candidate.nature,
    recipientId: candidate.recipientId,
    poolKey: candidate.poolKey,
    poolLabel: candidate.poolLabel,
    workType: candidate.workType,
    valueType: candidate.valueType,
    basisPoints: candidate.basisPoints,
    fixedCents: candidate.fixedCents,
    sortOrder: candidate.sortOrder,
    uniqueness: candidate.uniqueness,
    validFrom: candidate.validFrom,
    validTo: candidate.validTo,
    origin: candidate.origin,
    importBatchId: options.importBatchId ?? null,
    notes: input.notes?.trim() ?? '',
    createdByUserId: access.actor.id,
  })
  if (candidate.housingComplexIds.length > 0) {
    await tx.insert(financeRuleHousingComplex).values(
      candidate.housingComplexIds.map((housingComplexId) => ({
        ruleId: id,
        housingComplexId,
      })),
    )
  }
  await writeAudit(tx, {
    actor: access.actor,
    entityType: 'rule',
    entityId: id,
    action: options.version && options.version > 1 ? 'NOVA_VERSAO' : 'CRIADA',
    after: candidate,
  })
  return candidate
}

export async function createRule(access: FinanceAccess, input: RuleInput) {
  assertFinance(access, 'regras', { global: true })
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(RULES_LOCK)
      return insertRuleVersion(tx, access, input)
    })
  } catch (error) {
    mapDbError(error)
  }
}

/**
 * Nova versao (CT-11): encerra a versao vigente na vespera de `validFrom` e grava a
 * nova. Fechamentos antigos guardam a versao anterior no snapshot.
 */
export async function createRuleVersion(
  access: FinanceAccess,
  lineageId: string,
  input: RuleInput,
) {
  assertFinance(access, 'regras', { global: true })
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(RULES_LOCK)
      const [current] = await tx
        .select()
        .from(financeRule)
        .where(
          and(
            eq(financeRule.lineageId, lineageId),
            eq(financeRule.status, 'ATIVA'),
          ),
        )
        .orderBy(desc(financeRule.version))
        .limit(1)
      if (!current) {
        throw new FinanceServiceError(404, 'Regra não encontrada.')
      }
      if (input.validFrom < current.validFrom) {
        throw new FinanceServiceError(
          422,
          'A nova versão não pode começar antes da versão atual.',
        )
      }
      if (
        input.stage !== current.stage ||
        input.nature !== current.nature ||
        (input.recipientId ?? null) !== current.recipientId
      ) {
        throw new FinanceServiceError(
          422,
          'Nova versão mantém etapa, natureza e recebedor; para mudá-los, crie outra regra.',
        )
      }

      if (input.validFrom === current.validFrom) {
        const replacedAt = new Date()
        const [replaced] = await tx
          .update(financeRule)
          .set({
            status: 'REVOGADA',
            revokedAt: replacedAt,
            revokedByUserId: access.actor.id,
            revokeReason: 'Substituída por correção com a mesma vigência.',
          })
          .where(eq(financeRule.id, current.id))
          .returning()
        await writeAudit(tx, {
          actor: access.actor,
          entityType: 'rule',
          entityId: current.id,
          action: 'SUBSTITUIDA_MESMA_VIGENCIA',
          before: current,
          after: replaced,
        })
      } else {
        const newEnd = previousCivilDate(input.validFrom)
        if (current.validTo === null || current.validTo > newEnd) {
          await tx
            .update(financeRule)
            .set({ validTo: newEnd })
            .where(eq(financeRule.id, current.id))
          await writeAudit(tx, {
            actor: access.actor,
            entityType: 'rule',
            entityId: current.id,
            action: 'VIGENCIA_ENCERRADA',
            before: { validTo: current.validTo },
            after: { validTo: newEnd },
          })
        }
      }
      const latest = await tx
        .select({ version: financeRule.version })
        .from(financeRule)
        .where(eq(financeRule.lineageId, lineageId))
        .orderBy(desc(financeRule.version))
        .limit(1)
      return insertRuleVersion(tx, access, input, {
        lineageId,
        version: (latest[0]?.version ?? current.version) + 1,
        ignoreLineageId: lineageId,
      })
    })
  } catch (error) {
    mapDbError(error)
  }
}

export async function revokeRule(
  access: FinanceAccess,
  ruleId: string,
  reason: string,
) {
  assertFinance(access, 'regras', { global: true })
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(RULES_LOCK)
      const [before] = await tx
        .select()
        .from(financeRule)
        .where(eq(financeRule.id, ruleId))
        .for('update')
      if (!before) throw new FinanceServiceError(404, 'Regra não encontrada.')
      if (before.status === 'REVOGADA') {
        throw new FinanceServiceError(409, 'Regra já revogada.')
      }

      // Remover uma configuração não pode fazê-la "voltar" por uma versão
      // futura já agendada. Revoga a versão escolhida e as posteriores da
      // mesma linhagem; versões históricas anteriores permanecem intactas.
      const targets = await tx
        .select()
        .from(financeRule)
        .where(
          and(
            eq(financeRule.lineageId, before.lineageId),
            eq(financeRule.status, 'ATIVA'),
            gte(financeRule.validFrom, before.validFrom),
          ),
        )
        .for('update')

      const revokedAt = new Date()
      let selected = before
      for (const target of targets) {
        const [after] = await tx
          .update(financeRule)
          .set({
            status: 'REVOGADA',
            revokedAt,
            revokedByUserId: access.actor.id,
            revokeReason: reason.trim(),
          })
          .where(eq(financeRule.id, target.id))
          .returning()
        await writeAudit(tx, {
          actor: access.actor,
          entityType: 'rule',
          entityId: target.id,
          action: 'REVOGADA',
          reason,
          before: target,
          after,
        })
        if (target.id === ruleId && after) selected = after
      }
      return selected
    })
  } catch (error) {
    mapDbError(error)
  }
}

export async function listRules(access: FinanceAccess) {
  assertFinance(access, 'regras', { global: true })
  const rows = await db
    .select({ rule: financeRule, recipientName: financeRecipient.name })
    .from(financeRule)
    .leftJoin(
      financeRecipient,
      eq(financeRule.recipientId, financeRecipient.id),
    )
    .orderBy(
      asc(financeRule.stage),
      asc(financeRule.sortOrder),
      asc(financeRule.lineageId),
      asc(financeRule.version),
    )
  const links = rows.length
    ? await db
        .select({
          ruleId: financeRuleHousingComplex.ruleId,
          id: housingComplex.id,
          name: housingComplex.name,
        })
        .from(financeRuleHousingComplex)
        .innerJoin(
          housingComplex,
          eq(financeRuleHousingComplex.housingComplexId, housingComplex.id),
        )
    : []
  return rows.map(({ rule, recipientName }) => ({
    ...rule,
    recipientName,
    housingComplexes: links
      .filter((link) => link.ruleId === rule.id)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  }))
}

export { RULES_LOCK }
