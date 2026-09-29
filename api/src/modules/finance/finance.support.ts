import { createHash } from 'node:crypto'
import type { SQL } from 'drizzle-orm'
import type { db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { resolveUserPermissions } from '../permissions/permissions.service'
import type {
  ProfilePermissions,
  ResolvedPermissions,
} from '../permissions/permissions.types'
import { buildProcessVisibilityFilter } from '../processes/processes.access'
import { financeAuditLog } from './finance.schema'

export class FinanceServiceError extends ServiceError {}

export type FinanceTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type FinanceDb = typeof db | FinanceTx

export type FinanceFlag = keyof ProfilePermissions['financeiro']

export type FinanceActor = {
  id: string
  role: string
  requestId?: string
}

export type FinanceAccess = {
  actor: FinanceActor
  perms: ResolvedPermissions
  /** escopo global de processos (admin/MASTER ou perfil "todos") */
  isGlobal: boolean
  /** filtro SQL de processos visiveis (undefined = todos) */
  processFilter: SQL | undefined
}

export async function resolveFinanceAccess(
  actor: FinanceActor,
): Promise<FinanceAccess> {
  const perms = await resolveUserPermissions(actor.id, actor.role)
  return {
    actor,
    perms,
    isGlobal: perms.isAdmin || perms.processScope === 'all',
    processFilter: buildProcessVisibilityFilter(actor.id, perms),
  }
}

/**
 * Autorizacao financeira no SERVIDOR. Nenhum bypass implicito de admin comum: as
 * flags ja chegam resolvidas (MASTER = tudo; demais = perfil). Operacoes globais
 * (configuracao, fechamento, baixa, reserva, estorno) exigem escopo total.
 */
export function assertFinance(
  access: FinanceAccess,
  flag: FinanceFlag,
  options: { global?: boolean } = {},
): void {
  if (!access.perms.permissions.financeiro[flag]) {
    throw new FinanceServiceError(
      403,
      'Você não tem permissão para esta operação financeira.',
    )
  }
  if (options.global && !access.isGlobal) {
    throw new FinanceServiceError(
      403,
      'Esta operação financeira exige acesso a todos os processos.',
    )
  }
}

export async function writeAudit(
  tx: FinanceDb,
  input: {
    actor: FinanceActor
    entityType: string
    entityId: string
    action: string
    reason?: string | null
    before?: unknown
    after?: unknown
  },
): Promise<void> {
  await tx.insert(financeAuditLog).values({
    id: crypto.randomUUID(),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorUserId: input.actor.id,
    reason: input.reason ?? null,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    requestId: input.actor.requestId ?? null,
  })
}

/** JSON canonico (chaves ordenadas) — base de hashes reprodutiveis. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashPayload(value: unknown): string {
  return sha256(canonicalJson(value))
}

const saoPauloDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Instante (UTC) -> data civil YYYY-MM-DD em America/Sao_Paulo. */
export function toSaoPauloDate(instant: Date): string {
  return saoPauloDate.format(instant)
}

export function todaySaoPaulo(): string {
  return toSaoPauloDate(new Date())
}

/** YYYY-MM-DD menos um dia (data civil, sem fuso). */
export function previousCivilDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

type PgLikeError = { code?: string; constraint?: string; message?: string }

function pgCause(error: unknown): PgLikeError | null {
  const candidate = (error as { cause?: PgLikeError })?.cause ?? error
  return candidate && typeof candidate === 'object'
    ? (candidate as PgLikeError)
    : null
}

/**
 * Converte violacoes de constraint/trigger do PostgreSQL em erro de dominio.
 * Mensagens de trigger ja sao em pt-BR e sem dados sensiveis.
 */
export function mapDbError(error: unknown, fallback?: string): never {
  if (error instanceof ServiceError) throw error
  const cause = pgCause(error)
  if (cause?.code === '23505') {
    throw new FinanceServiceError(
      409,
      fallback ?? 'Operação duplicada: o registro já existe.',
    )
  }
  if (cause?.code === '23514' || cause?.code === '23001') {
    // CHECK de tabela tem `constraint` (mensagem tecnica em ingles); trigger nao —
    // a mensagem do trigger ja e de dominio.
    throw new FinanceServiceError(
      409,
      cause.constraint
        ? (fallback ?? `Dados recusados pela regra ${cause.constraint}.`)
        : (cause.message ?? fallback ?? 'Operação recusada.'),
    )
  }
  if (cause?.code === '23503') {
    throw new FinanceServiceError(
      409,
      fallback ?? 'Registro vinculado a lançamento financeiro.',
    )
  }
  throw error
}

export function isUniqueViolation(error: unknown): boolean {
  return pgCause(error)?.code === '23505'
}
