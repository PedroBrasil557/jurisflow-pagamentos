import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { closeDb, db } from '../../shared/db'
import { user } from '../auth/auth.schema'
import { process as processTable } from '../processes/processes.schema'
import {
  financeClosing,
  financeClosingItem,
  financeClosingLine,
  financeReceipt,
  financeRecipient,
  financeReserveMovement,
} from './finance.schema'

// INTEGRACAO com PostgreSQL real: prova as garantias que moram no BANCO (indices
// unicos parciais, FKs RESTRICT, triggers de imutabilidade e de saldo), inclusive
// sob concorrencia. Roda SO com RUN_INTEGRATION=1 e DATABASE_URL num banco *_test
// isolado (ver scripts/test-finance-integration.ts). Nunca no banco `app`.
const RUN = process.env.RUN_INTEGRATION === '1'
const databaseName = new URL(
  process.env.DATABASE_URL ?? 'postgresql://x@localhost/app',
).pathname.slice(1)
if (RUN && !databaseName.endsWith('_test')) {
  throw new Error(
    `Integracao financeira recusada: DATABASE_URL aponta para "${databaseName}" (exige banco *_test).`,
  )
}
const suite = RUN ? describe : describe.skip

const run = crypto.randomUUID().slice(0, 8)
const userId = `fin-test-user-${run}`
const recipientId = `fin-test-recipient-${run}`
let seq = 0
const nextId = (prefix: string) => `${prefix}-${run}-${++seq}`

async function createProcess() {
  const id = nextId('fin-proc')
  await db.insert(processTable).values({
    id,
    code: `FIN-${run}-${seq}`,
    fullName: 'Pessoa Ficticia',
    nationality: '',
    maritalStatus: '',
    profession: '',
    ownerType: '',
    cpf: '',
    rg: '',
    cadunico: '',
    propertyPaidOff: '',
    state: '',
    city: '',
    district: '',
    housingComplex: '',
    street: '',
    number: '',
    complement: '',
    zipcode: '',
    email: '',
    whatsapp: '',
    observation: '',
    createdByUserId: userId,
  })
  return id
}

async function createReceipt(processId: string, amountCents = 1_200_000) {
  const id = nextId('fin-rec')
  await db.insert(financeReceipt).values({
    id,
    processId,
    kind: 'HONORARIOS_CONTRATUAIS',
    amountCents,
    status: 'CONFERIDO',
    releaseDate: '2026-09-01',
    referenceDate: '2026-03-10',
    referenceDateSource: 'CADASTRO_PROCESSO',
    idempotencyKey: nextId('idem'),
    createdByUserId: userId,
    verifiedByUserId: userId,
    verifiedAt: new Date(),
  })
  return id
}

async function createClosing() {
  const id = nextId('fin-closing')
  await db.insert(financeClosing).values({
    id,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    algorithmVersion: 'pagamentos-calc-v1',
    inputHash: 'hash',
    rulesSnapshot: [],
    configSnapshot: {},
    totals: {},
    receiptCount: 1,
    grossCents: 1_200_000,
    idempotencyKey: nextId('idem'),
    createdByUserId: userId,
  })
  return id
}

function closingItem(closingId: string, receiptId: string) {
  return {
    id: nextId('fin-item'),
    closingId,
    receiptId,
    receiptSnapshot: {},
    calculation: {},
  }
}

function reserveMovement(
  processId: string,
  kind: 'CONSTITUICAO' | 'DESPESA' | 'TRANSFERENCIA',
  amountCents: number,
  extra: { closingId?: string; receiptId?: string } = {},
) {
  return {
    id: nextId('fin-mov'),
    pool: 'CERTIDAO' as const,
    kind,
    amountCents,
    processId,
    movementDate: '2026-09-10',
    idempotencyKey: nextId('idem'),
    createdByUserId: userId,
    ...extra,
  }
}

async function certidaoBalance(processId: string) {
  const result = await db.execute<{ balance: string }>(sql`
    SELECT coalesce(sum(CASE WHEN kind = 'CONSTITUICAO' THEN amount_cents ELSE -amount_cents END), 0) AS balance
    FROM finance_reserve_movement
    WHERE pool = 'CERTIDAO' AND status = 'ATIVO' AND process_id = ${processId}`)
  return Number(result.rows[0]?.balance)
}

// Query builders do Drizzle sao thenables. Exige que a operacao FALHE e que a
// falha venha da garantia esperada (constraint/trigger), nao de um erro qualquer.
async function rejectsWith(query: PromiseLike<unknown>, expected: RegExp) {
  let failure: unknown = null
  try {
    await query
  } catch (error) {
    failure = error
  }
  if (!failure) throw new Error(`Operacao deveria falhar (${expected}).`)
  expect(pgMessage(failure)).toMatch(expected)
}

function pgMessage(error: unknown): string {
  const cause = (error as { cause?: { message?: string } }).cause
  return `${(error as Error).message} ${cause?.message ?? ''}`
}

suite('financeiro: garantias do PostgreSQL (integracao)', () => {
  beforeAll(async () => {
    await db.insert(user).values({
      id: userId,
      name: 'Teste Financeiro',
      email: `${userId}@test.local`,
    })
    await db.insert(financeRecipient).values({
      id: recipientId,
      name: 'Destinatario Ficticio',
      kind: 'PESSOA_FISICA',
      createdByUserId: userId,
    })
  })

  afterAll(async () => {
    // Registros financeiros sao indeleteis por design: o banco *_test acumula
    // dados de execucoes anteriores (ids aleatorios por execucao isolam os testes).
    await closeDb()
  })

  test('reserva de certidao: 500 -> despesa 180 -> 320 -> transferencia 100 -> 220', async () => {
    const processId = await createProcess()
    const receiptId = await createReceipt(processId)
    const closingId = await createClosing()
    await db.insert(financeReserveMovement).values(
      reserveMovement(processId, 'CONSTITUICAO', 50_000, {
        closingId,
        receiptId,
      }),
    )
    expect(await certidaoBalance(processId)).toBe(50_000)
    await db
      .insert(financeReserveMovement)
      .values(reserveMovement(processId, 'DESPESA', 18_000))
    expect(await certidaoBalance(processId)).toBe(32_000)
    await db
      .insert(financeReserveMovement)
      .values(reserveMovement(processId, 'TRANSFERENCIA', 10_000))
    expect(await certidaoBalance(processId)).toBe(22_000)

    // Debito acima do saldo: o trigger impede saldo inexistente.
    const overdraft = db
      .insert(financeReserveMovement)
      .values(reserveMovement(processId, 'DESPESA', 22_001))
    await rejectsWith(overdraft, /ficaria negativo/)
    expect(await certidaoBalance(processId)).toBe(22_000)

    // Segunda constituicao ativa para o mesmo processo: indice unico parcial.
    const second = db.insert(financeReserveMovement).values(
      reserveMovement(processId, 'CONSTITUICAO', 50_000, {
        closingId,
        receiptId,
      }),
    )
    await rejectsWith(second, /finance_reserve_certidao_once_idx/)

    // Movimento nao pode ser apagado nem alterado (so estornado).
    const [movement] = await db
      .select({ id: financeReserveMovement.id })
      .from(financeReserveMovement)
      .where(eq(financeReserveMovement.processId, processId))
      .limit(1)
    await rejectsWith(
      db
        .delete(financeReserveMovement)
        .where(eq(financeReserveMovement.id, movement?.id ?? '')),
      /nao pode ser apagado/,
    )
  })

  test('constituicoes CONCORRENTES da reserva do mesmo processo: exatamente uma vence', async () => {
    const processId = await createProcess()
    const receiptId = await createReceipt(processId)
    const closingId = await createClosing()
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        db.transaction(async (tx) => {
          await tx.insert(financeReserveMovement).values(
            reserveMovement(processId, 'CONSTITUICAO', 50_000, {
              closingId,
              receiptId,
            }),
          )
          await tx.execute(sql`SELECT pg_sleep(0.05)`)
        }),
      ),
    )
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1)
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        expect(pgMessage(attempt.reason)).toMatch(
          /finance_reserve_certidao_once_idx/,
        )
      }
    }
    expect(await certidaoBalance(processId)).toBe(50_000)
  })

  test('recebimento nao integra dois fechamentos ativos, mesmo concorrendo', async () => {
    const processId = await createProcess()
    const receiptId = await createReceipt(processId)
    const closings = await Promise.all(
      Array.from({ length: 5 }, () => createClosing()),
    )
    const attempts = await Promise.allSettled(
      closings.map((closingId) =>
        db.transaction(async (tx) => {
          await tx
            .insert(financeClosingItem)
            .values(closingItem(closingId, receiptId))
          await tx.execute(sql`SELECT pg_sleep(0.05)`)
        }),
      ),
    )
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1)
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') {
        expect(pgMessage(attempt.reason)).toMatch(
          /finance_closing_item_active_receipt_idx/,
        )
      }
    }

    // Apos o estorno (item desativado), o recebimento pode entrar em outro.
    const [active] = await db
      .select()
      .from(financeClosingItem)
      .where(eq(financeClosingItem.receiptId, receiptId))
    await db
      .update(financeClosingItem)
      .set({ isActive: false })
      .where(eq(financeClosingItem.id, active?.id ?? ''))
    const other = closings.find((id) => id !== active?.closingId) ?? ''
    await db.insert(financeClosingItem).values(closingItem(other, receiptId))

    // Reativar o item antigo e proibido (trigger) — e violaria o indice.
    await rejectsWith(
      db
        .update(financeClosingItem)
        .set({ isActive: true })
        .where(eq(financeClosingItem.id, active?.id ?? '')),
      /imutavel/,
    )
  })

  test('linhas e snapshot do fechamento sao imutaveis', async () => {
    const processId = await createProcess()
    const receiptId = await createReceipt(processId)
    const closingId = await createClosing()
    const item = closingItem(closingId, receiptId)
    await db.insert(financeClosingItem).values(item)
    const lineId = nextId('fin-line')
    await db.insert(financeClosingLine).values({
      id: lineId,
      closingId,
      closingItemId: item.id,
      receiptId,
      processId,
      releaseDate: '2026-09-01',
      sequence: 1,
      rubric: 'DISTRIBUICAO_SALDO',
      recipientId,
      basisCents: 104_592,
      amountCents: 104_592,
      description: 'Saldo final',
    })
    await rejectsWith(
      db
        .update(financeClosingLine)
        .set({ amountCents: 1 })
        .where(eq(financeClosingLine.id, lineId)),
      /imutavel/,
    )
    await rejectsWith(
      db.delete(financeClosingLine).where(eq(financeClosingLine.id, lineId)),
      /imutavel/,
    )
    await rejectsWith(
      db
        .update(financeClosing)
        .set({ totals: { adulterado: true } })
        .where(eq(financeClosing.id, closingId)),
      /Snapshot do fechamento e imutavel/,
    )
    // Estorno (status + motivo) e a unica mudanca aceita.
    await db
      .update(financeClosing)
      .set({
        status: 'ESTORNADO',
        reversedAt: new Date(),
        reversedByUserId: userId,
        reversalReason: 'Teste de estorno',
      })
      .where(eq(financeClosing.id, closingId))
    await rejectsWith(
      db
        .update(financeClosing)
        .set({ status: 'ATIVO' })
        .where(eq(financeClosing.id, closingId)),
      /estornado nao pode/,
    )
  })

  test('recebimento fechado nao muda valor; recebimento nao e apagado', async () => {
    const processId = await createProcess()
    const receiptId = await createReceipt(processId)
    await db
      .update(financeReceipt)
      .set({ status: 'FECHADO' })
      .where(eq(financeReceipt.id, receiptId))
    await rejectsWith(
      db
        .update(financeReceipt)
        .set({ amountCents: 1_199_999 })
        .where(eq(financeReceipt.id, receiptId)),
      /nao pode ter valores alterados/,
    )
    await rejectsWith(
      db.delete(financeReceipt).where(eq(financeReceipt.id, receiptId)),
      /nao pode ser apagado/,
    )
  })

  test('valores invalidos sao recusados pelas CHECKs', async () => {
    const processId = await createProcess()
    await rejectsWith(createReceipt(processId, 0), /finance_receipt_amount_chk/)
    await rejectsWith(
      createReceipt(processId, -100),
      /finance_receipt_amount_chk/,
    )
  })

  test('exclusao de processo: bloqueada com financeiro, preservada sem', async () => {
    const withFinance = await createProcess()
    await createReceipt(withFinance)
    const blocked = db
      .delete(processTable)
      .where(eq(processTable.id, withFinance))
    try {
      await blocked
      throw new Error('deveria falhar')
    } catch (error) {
      expect(pgMessage(error)).toMatch(/foreign key|violates|viola/i)
    }

    const { deleteProcess } = await import('../processes/processes.service')
    await rejectsWith(
      deleteProcess(withFinance),
      /Processo possui lancamentos financeiros e nao pode ser excluido/,
    )

    const withoutFinance = await createProcess()
    await db.delete(processTable).where(eq(processTable.id, withoutFinance))
    const rows = await db
      .select({ id: processTable.id })
      .from(processTable)
      .where(eq(processTable.id, withoutFinance))
    expect(rows).toHaveLength(0)
  })
})
