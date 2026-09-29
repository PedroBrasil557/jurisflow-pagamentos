import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { closeDb, db } from '../../shared/db'
import { ServiceError } from '../../shared/errors/service-error'
import { user } from '../auth/auth.schema'
import { housingComplex } from '../housing-complexes/housing-complexes.schema'
import { DEFAULT_USER_PERMISSIONS } from '../permissions/permissions.defaults'
import {
  permissionProfile,
  profileHousingComplex,
  userProfile,
} from '../permissions/permissions.schema'
import type { ProfilePermissions } from '../permissions/permissions.types'
import { process as processTable } from '../processes/processes.schema'
import {
  createAdjustment,
  createClosing,
  createPayout,
  getClosingDetail,
  listCredits,
  reverseClosing,
  reversePayout,
} from './finance.closings.service'
import {
  createRecipient,
  createRule,
  createRuleVersion,
  listRecipients,
  listRules,
  type RuleInput,
} from './finance.config.service'
import type { FinanceCalcStep } from './finance.engine'
import { confirmImport, previewImport } from './finance.import.service'
import {
  approveReceipt,
  calculateReceipt,
  createReceipt,
  getReceiptDetail,
  listReceipts,
} from './finance.receipts.service'
import {
  createReserveDebit,
  exportStatementCsv,
  getOverview,
  getStatement,
  reserveBalances,
  reserveProcessBalances,
} from './finance.reports.service'
import {
  financeClosing,
  financeClosingLine,
  financeCredit,
  financeReceipt,
  financeReserveMovement,
  financeRule,
} from './finance.schema'
import {
  type FinanceAccess,
  previousCivilDate,
  resolveFinanceAccess,
  todaySaoPaulo,
} from './finance.support'

const TODAY = todaySaoPaulo()
const YESTERDAY = previousCivilDate(TODAY)

// INTEGRACAO ponta a ponta (CT-01..CT-18 da V3 §26) pelos SERVICOS reais em
// PostgreSQL isolado e recriado (scripts/test-finance-integration.ts). Dados e
// percentuais sao FICTICIOS (cenario TEST-001) e existem somente neste teste.
const RUN = process.env.RUN_INTEGRATION === '1'
const databaseName = new URL(
  process.env.DATABASE_URL ?? 'postgresql://x@localhost/app',
).pathname.slice(1)
if (RUN && !databaseName.endsWith('_test')) {
  throw new Error(
    `Integração financeira recusada: DATABASE_URL aponta para "${databaseName}" (exige banco *_test).`,
  )
}
const suite = RUN ? describe : describe.skip

const ids = {
  admin: 'fin-admin',
  viewer: 'fin-viewer',
  noAccess: 'fin-no-access',
  cond1: 'fin-cond-1',
  cond2: 'fin-cond-2',
  cond3: 'fin-cond-3',
  cond4: 'fin-cond-4',
}
let seq = 0
const key = (label: string) => `${label}-${crypto.randomUUID()}`
const REG_DATE = new Date('2026-03-10T15:00:00Z') // 10/03/2026 em Sao Paulo

const allFinance: ProfilePermissions['financeiro'] = {
  view: true,
  lancar: true,
  conferir: true,
  fechar: true,
  baixar: true,
  regras: true,
  importar: true,
  reservas: true,
  estornar: true,
  exportar: true,
}

async function createProcess(
  housingComplexId: string | null,
  createdAt = REG_DATE,
) {
  seq += 1
  const id = `fin-proc-${seq}`
  const [complex] = housingComplexId
    ? await db
        .select({ name: housingComplex.name })
        .from(housingComplex)
        .where(eq(housingComplex.id, housingComplexId))
    : [undefined]
  await db.insert(processTable).values({
    id,
    code: `FIN-${seq}`,
    fullName: `Cliente Fictício ${seq}`,
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
    housingComplex: complex?.name ?? '',
    housingComplexId,
    street: '',
    number: '',
    complement: '',
    zipcode: '',
    email: '',
    whatsapp: '',
    observation: '',
    createdByUserId: ids.admin,
    createdAt,
  })
  return id
}

// expect().rejects do Bun 1.4.2/Windows trava com erros do driver pg; try/catch.
async function expectDbFailure(query: PromiseLike<unknown>) {
  let failed = false
  try {
    await query
  } catch {
    failed = true
  }
  expect(failed).toBe(true)
}

async function expectFinanceError(
  promise: Promise<unknown>,
  status: ServiceError['statusCode'],
  message?: RegExp,
) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError)
    expect((error as ServiceError).statusCode).toBe(status)
    if (message) expect((error as Error).message).toMatch(message)
    return
  }
  throw new Error(`Esperava erro ${status}.`)
}

async function newReceipt(
  access: FinanceAccess,
  processId: string,
  amountCents: number,
  releaseDate = '2026-09-01',
) {
  const { receipt } = await createReceipt(access, {
    idempotencyKey: key('rec'),
    processId,
    kind: 'HONORARIOS_CONTRATUAIS',
    amountCents,
    releaseDate,
    reference: 'Alvará fictício',
  })
  return receipt
}

async function calculateAndApprove(access: FinanceAccess, receiptId: string) {
  const calculated = await calculateReceipt(access, receiptId)
  expect(calculated?.status).toBe('EM_PREVIA')
  return approveReceipt(access, receiptId)
}

const steps = (receipt: { lastCalculation: unknown } | undefined) =>
  ((receipt?.lastCalculation as { steps: FinanceCalcStep[] })?.steps ??
    []) as FinanceCalcStep[]
const stepAmount = (list: FinanceCalcStep[], code: string) =>
  list.find((s) => s.code === code)?.amountCents

suite(
  'Pagamentos V3 — fluxo completo em PostgreSQL real (CT-01..CT-18)',
  () => {
    let admin: FinanceAccess
    let viewer: FinanceAccess
    let noAccess: FinanceAccess
    const recipients: Record<string, string> = {}
    const manualRules = new Map<string, string>() // nome -> id da versao
    let p1: string
    let closingId: string
    let firstReceiptId: string

    beforeAll(async () => {
      for (const [id, name] of [
        [ids.admin, 'Gestor financeiro fictício'],
        [ids.viewer, 'Consulta condomínio 2'],
        [ids.noAccess, 'Sem acesso financeiro'],
      ] as const) {
        await db.insert(user).values({ id, name, email: `${id}@test.local` })
      }
      for (const [id, name] of [
        [ids.cond1, 'Condomínio Teste 1'],
        [ids.cond2, 'Condomínio Teste 2'],
        [ids.cond3, 'Condomínio Teste 3'],
        [ids.cond4, 'Condomínio Teste 4'],
      ] as const) {
        await db.insert(housingComplex).values({ id, name })
      }
      await db.insert(permissionProfile).values([
        {
          id: 'fin-profile-all',
          name: 'Financeiro total (teste)',
          processScope: 'all',
          permissions: { ...DEFAULT_USER_PERMISSIONS, financeiro: allFinance },
        },
        {
          id: 'fin-profile-viewer',
          name: 'Financeiro leitura cond. 2 (teste)',
          processScope: 'housing_complex',
          permissions: {
            ...DEFAULT_USER_PERMISSIONS,
            financeiro: { ...DEFAULT_USER_PERMISSIONS.financeiro, view: true },
          },
        },
      ])
      await db.insert(profileHousingComplex).values({
        profileId: 'fin-profile-viewer',
        housingComplexId: ids.cond2,
      })
      await db.insert(userProfile).values([
        { userId: ids.admin, profileId: 'fin-profile-all' },
        { userId: ids.viewer, profileId: 'fin-profile-viewer' },
      ])
      admin = await resolveFinanceAccess({ id: ids.admin, role: 'user' })
      viewer = await resolveFinanceAccess({ id: ids.viewer, role: 'user' })
      noAccess = await resolveFinanceAccess({ id: ids.noAccess, role: 'user' })
      p1 = await createProcess(ids.cond1)
    })

    afterAll(async () => {
      await closeDb()
    })

    test('CT-01 sistema vazio: nada configurado e totais zerados', async () => {
      expect(await listRecipients(admin)).toEqual([])
      expect(await listRules(admin)).toEqual([])
      const overview = await getOverview(admin)
      expect(overview.receipts.count).toBe(0)
      expect(overview.receipts.grossCents).toBe(0)
      expect(overview.credits).toEqual({
        dueCents: 0,
        paidCents: 0,
        balanceCents: 0,
      })
      expect(overview.reservesBalanceCents).toBe(0)
      expect(overview.config).toEqual({ recipients: 0, activeRules: 0 })
    })

    test('CT-05 sem regra aplicável: BLOQUEADO com causa, sem valores inventados', async () => {
      const receipt = await newReceipt(admin, p1, 1_200_000)
      const calculated = await calculateReceipt(admin, receipt.id)
      expect(calculated?.status).toBe('BLOQUEADO')
      const calc = calculated?.lastCalculation as {
        blocks: { code: string; fix: string }[]
        steps: unknown[]
      }
      expect(calc.blocks[0]?.code).toBe('SEM_REGRA_APLICAVEL')
      expect(calc.blocks[0]?.fix).toContain('Configuração')
      expect(calc.steps).toEqual([])
      firstReceiptId = receipt.id
    })

    test('CT-02 cadastro manual persistido e versionado (TEST-001 no condomínio 1)', async () => {
      for (const name of [
        'Colaborador A',
        'Colaborador B',
        'Colaborador C',
        'Parceiro D',
        'Distribuição E',
        'Distribuição F',
      ]) {
        const recipient = await createRecipient(admin, {
          name,
          kind: 'PESSOA_FISICA',
        })
        recipients[name] = recipient?.id as string
      }
      const base = { validFrom: '2025-01-01', housingComplexIds: [ids.cond1] }
      const definitions: [string, RuleInput][] = [
        [
          'prov',
          {
            ...base,
            stage: 'PROVISAO_RECEITA',
            nature: 'PROVISAO',
            poolLabel: 'Provisão de teste',
            valueType: 'PERCENTUAL',
            basisPoints: 2000,
          },
        ],
        [
          'A',
          {
            ...base,
            stage: 'DEDUCAO_LIQUIDA',
            nature: 'CREDITO',
            recipientId: recipients['Colaborador A'],
            valueType: 'PERCENTUAL',
            basisPoints: 300,
            sortOrder: 1,
          },
        ],
        [
          'B',
          {
            ...base,
            stage: 'DEDUCAO_LIQUIDA',
            nature: 'CREDITO',
            recipientId: recipients['Colaborador B'],
            valueType: 'PERCENTUAL',
            basisPoints: 200,
            sortOrder: 2,
          },
        ],
        [
          'desp',
          {
            ...base,
            stage: 'DEDUCAO_LIQUIDA',
            nature: 'PROVISAO',
            poolLabel: 'Despesa percentual',
            valueType: 'PERCENTUAL',
            basisPoints: 400,
            sortOrder: 3,
          },
        ],
        [
          'C',
          {
            ...base,
            stage: 'DEDUCAO_LIQUIDA',
            nature: 'CREDITO',
            recipientId: recipients['Colaborador C'],
            valueType: 'PERCENTUAL',
            basisPoints: 250,
            sortOrder: 4,
          },
        ],
        [
          'res',
          {
            ...base,
            stage: 'RESERVA',
            nature: 'RESERVA',
            poolLabel: 'Reserva de teste',
            valueType: 'VALOR_FIXO',
            fixedCents: 50_000,
            uniqueness: 'UNICA_POR_PROCESSO',
          },
        ],
        [
          'D',
          {
            ...base,
            stage: 'PARTICIPACAO_RESULTADO',
            nature: 'CREDITO',
            recipientId: recipients['Parceiro D'],
            valueType: 'PERCENTUAL',
            basisPoints: 5000,
          },
        ],
        [
          'E',
          {
            ...base,
            stage: 'DISTRIBUICAO_FINAL',
            nature: 'CREDITO',
            recipientId: recipients['Distribuição E'],
            valueType: 'PERCENTUAL',
            basisPoints: 4000,
            sortOrder: 1,
          },
        ],
        [
          'F',
          {
            ...base,
            stage: 'DISTRIBUICAO_FINAL',
            nature: 'CREDITO',
            recipientId: recipients['Distribuição F'],
            valueType: 'PERCENTUAL',
            basisPoints: 6000,
            sortOrder: 2,
          },
        ],
      ]
      for (const [name, input] of definitions) {
        const rule = await createRule(admin, input)
        expect(rule?.version).toBe(1)
        expect(rule?.lineageId).toBe(rule?.id as string)
        manualRules.set(name, rule?.id as string)
      }
      const rules = await listRules(admin)
      expect(rules).toHaveLength(9)
      expect(
        rules.every((r) => r.origin === 'MANUAL' && r.status === 'ATIVA'),
      ).toBe(true)
      // Sobreposicao do mesmo contexto e recusada no servidor
      await expectFinanceError(
        createRule(admin, definitions[1]?.[1] as RuleInput),
        409,
        /Sobreposição/,
      )
    })

    test('CT-04 recebimento → prévia A–P → aprovação → fechamento → créditos', async () => {
      // O recebimento bloqueado do CT-05 agora calcula com as regras cadastradas.
      const calculated = await calculateReceipt(admin, firstReceiptId)
      expect(calculated?.status).toBe('EM_PREVIA')
      const list = steps(calculated)
      expect(stepAmount(list, 'B')).toBe(240_000)
      expect(stepAmount(list, 'C')).toBe(960_000)
      expect(stepAmount(list, 'D')).toBe(160_400)
      expect(stepAmount(list, 'J')).toBe(799_600)
      expect(stepAmount(list, 'M')).toBe(399_800)
      expect(stepAmount(list, 'N.1')).toBe(159_920)
      expect(stepAmount(list, 'N.2')).toBe(239_880)
      expect(stepAmount(list, 'P')).toBe(0)
      const approved = await approveReceipt(admin, firstReceiptId)
      expect(approved?.status).toBe('APTO')

      const { closing } = await createClosing(admin, {
        idempotencyKey: key('closing'),
        receiptIds: [firstReceiptId],
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      })
      closingId = closing.id
      expect(closing.code).toMatch(/^FEC-\d{6}$/)
      const [receipt] = await db
        .select()
        .from(financeReceipt)
        .where(eq(financeReceipt.id, firstReceiptId))
      expect(receipt?.status).toBe('FECHADO')
      const credits = await listCredits(admin, { closingId })
      // CT-12: tres participantes na mesma etapa + parceiro + duas distribuicoes
      expect(
        credits.map((c) => [c.recipientName, c.amountCents]).sort(),
      ).toEqual(
        [
          ['Colaborador A', 28_800],
          ['Colaborador B', 19_200],
          ['Colaborador C', 24_000],
          ['Distribuição E', 159_920],
          ['Distribuição F', 239_880],
          ['Parceiro D', 399_800],
        ].sort(),
      )
      const reserves = await reserveBalances(admin)
      expect(
        Object.fromEntries(reserves.map((r) => [r.poolLabel, r.balanceCents])),
      ).toEqual({
        'Despesa percentual': 38_400,
        'Provisão de teste': 240_000,
        'Reserva de teste': 50_000,
      })
      // Conciliacao: creditos + provisoes + reservas = receita total
      const creditSum = credits.reduce((s, c) => s + c.amountCents, 0)
      const reserveSum = reserves.reduce((s, r) => s + r.balanceCents, 0)
      expect(creditSum + reserveSum).toBe(1_200_000)

      // Baixa total de um credito: PAGO e saldo zero no extrato
      const creditE = credits.find((c) => c.recipientName === 'Distribuição E')
      const { payout } = await createPayout(admin, {
        idempotencyKey: key('payout'),
        creditId: creditE?.id as string,
        amountCents: 159_920,
        paidOn: TODAY,
        reference: 'TED fictícia 001',
      })
      expect(payout?.balanceAfterCents).toBe(0)
      const statement = await getStatement(admin, {
        recipientId: recipients['Distribuição E'],
        processId: p1,
      })
      expect(statement.totals.closingBalanceCents).toBe(0)
      const [credit] = await db
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.id, creditE?.id as string))
      expect(credit?.status).toBe('PAGO')
    })

    test('fechamento idempotente, imutável e sem recebimento em dois lotes', async () => {
      const receipt = await newReceipt(
        admin,
        await createProcess(ids.cond1),
        1_000_000,
      )
      await calculateAndApprove(admin, receipt.id)
      const input = {
        idempotencyKey: key('closing'),
        receiptIds: [receipt.id],
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      }
      // double submit concorrente com a mesma chave: um unico fechamento
      const [a, b] = await Promise.all([
        createClosing(admin, input),
        createClosing(admin, input),
      ])
      expect(a.closing.id).toBe(b.closing.id)
      expect([a.replayed, b.replayed].sort()).toEqual([false, true])
      // mesma chave com outro conteudo: conflito
      await expectFinanceError(
        createClosing(admin, { ...input, notes: 'outro' }),
        409,
        /idempotência/,
      )
      // outra chave com o mesmo recebimento: recusado (ja FECHADO)
      await expectFinanceError(
        createClosing(admin, { ...input, idempotencyKey: key('closing') }),
        409,
      )
      // INV-07: snapshot e linhas nao mudam nem por SQL direto
      await expectDbFailure(
        db.execute(
          sql`UPDATE finance_closing SET totals = '{}' WHERE id = ${a.closing.id}`,
        ),
      )
      await expectDbFailure(
        db.execute(
          sql`UPDATE finance_closing_line SET amount_cents = 1 WHERE closing_id = ${a.closing.id}`,
        ),
      )
    })

    test('dois lotes concorrentes com o mesmo recebimento: exatamente um fecha', async () => {
      const receipt = await newReceipt(
        admin,
        await createProcess(ids.cond1),
        900_000,
      )
      await calculateAndApprove(admin, receipt.id)
      const attempts = await Promise.allSettled(
        [1, 2, 3].map(() =>
          createClosing(admin, {
            idempotencyKey: key('closing'),
            receiptIds: [receipt.id],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-30',
          }),
        ),
      )
      expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    })

    test('CT-08 / P09 segundo recebimento do processo não duplica a reserva única', async () => {
      const second = await newReceipt(admin, p1, 1_200_000, '2026-09-15')
      const calculated = await calculateReceipt(admin, second.id)
      const list = steps(calculated)
      const reserve = list.find((s) => s.code === 'I.1')
      expect(reserve?.amountCents).toBe(0)
      expect(reserve?.note).toContain('INV-05')
      expect(stepAmount(list, 'J')).toBe(849_600)
      // dois recebimentos em aberto de um processo novo: o primeiro leva a reserva
      const p = await createProcess(ids.cond1)
      const r1 = await newReceipt(admin, p, 600_000, '2026-09-02')
      const r2 = await newReceipt(admin, p, 600_000, '2026-09-10')
      const c2 = steps(await calculateReceipt(admin, r2.id))
      const c1 = steps(await calculateReceipt(admin, r1.id))
      expect(stepAmount(c1, 'I.1')).toBe(50_000)
      expect(stepAmount(c2, 'I.1')).toBe(0)
      // e o banco garante a unicidade mesmo por SQL direto
      const [closingLine] = await db
        .select()
        .from(financeClosingLine)
        .where(eq(financeClosingLine.closingId, closingId))
        .limit(1)
      await expectDbFailure(
        db.insert(financeReserveMovement).values({
          id: crypto.randomUUID(),
          poolKey: 'reserva-de-teste',
          poolLabel: 'Reserva de teste',
          nature: 'RESERVA',
          kind: 'CONSTITUICAO',
          uniquePerProcess: true,
          amountCents: 50_000,
          processId: p1,
          closingId,
          receiptId: firstReceiptId,
          closingLineId: closingLine?.id as string,
          movementDate: '2026-09-15',
          idempotencyKey: key('dup'),
          requestHash: 'x',
          createdByUserId: ids.admin,
        }),
      )
    })

    test('CT-09 / CT-10 baixa parcial, acima do saldo e concorrente', async () => {
      const credits = await listCredits(admin, { closingId })
      const creditF = credits.find((c) => c.recipientName === 'Distribuição F')
      const { payout } = await createPayout(admin, {
        idempotencyKey: key('payout'),
        creditId: creditF?.id as string,
        amountCents: 100_000,
        paidOn: TODAY,
        reference: 'PIX fictício 002',
      })
      expect(payout?.balanceAfterCents).toBe(139_880)
      const [partial] = await db
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.id, creditF?.id as string))
      expect(partial?.status).toBe('PARCIALMENTE_PAGO')
      await expectFinanceError(
        createPayout(admin, {
          idempotencyKey: key('payout'),
          creditId: creditF?.id as string,
          amountCents: 139_881,
          paidOn: YESTERDAY,
          reference: 'acima',
        }),
        422,
        /excede/,
      )
      // idempotencia de baixa: repeticao da mesma chave nao duplica
      const idem = key('payout')
      const body = {
        idempotencyKey: idem,
        creditId: creditF?.id as string,
        amountCents: 10_000,
        paidOn: YESTERDAY,
        reference: 'PIX fictício 003',
      }
      const first = await createPayout(admin, body)
      const again = await createPayout(admin, body)
      expect(again.replayed).toBe(true)
      expect(again.payout?.id).toBe(first.payout?.id)
      // concorrencia: duas baixas que juntas excedem o saldo (129.880): so uma passa
      const racing = await Promise.allSettled(
        [100_000, 100_000].map((amountCents) =>
          createPayout(admin, {
            idempotencyKey: key('payout'),
            creditId: creditF?.id as string,
            amountCents,
            paidOn: TODAY,
            reference: 'concorrente',
          }),
        ),
      )
      expect(racing.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const [after] = await db
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.id, creditF?.id as string))
      expect(after?.paidCents).toBe(210_000)
      expect(after?.paidCents).toBeLessThanOrEqual(after?.amountCents ?? 0)
    })

    test('CT-16 estorno de baixa preserva histórico e restaura saldo', async () => {
      const credits = await listCredits(admin, { closingId })
      const creditE = credits.find((c) => c.recipientName === 'Distribuição E')
      const statementBefore = await getStatement(admin, {
        recipientId: recipients['Distribuição E'],
        processId: p1,
      })
      const payoutId = statementBefore.entries.find(
        (e) => e.kind === 'BAIXA',
      )?.payoutId
      await reversePayout(
        admin,
        payoutId as string,
        'Transferência devolvida (teste)',
      )
      const statement = await getStatement(admin, {
        recipientId: recipients['Distribuição E'],
        processId: p1,
      })
      expect(statement.entries.map((e) => e.kind)).toEqual([
        'CREDITO',
        'BAIXA',
        'ESTORNO_BAIXA',
      ])
      expect(statement.totals.closingBalanceCents).toBe(159_920)
      const [credit] = await db
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.id, creditE?.id as string))
      expect(credit?.status).toBe('ABERTO')
      // baixa nunca e apagada
      await expectDbFailure(
        db.execute(
          sql`DELETE FROM finance_payout WHERE id = ${payoutId as string}`,
        ),
      )
      // ajuste com motivo altera o devido sem editar o credito original
      await createAdjustment(admin, {
        idempotencyKey: key('adj'),
        creditId: creditE?.id as string,
        amountCents: -920,
        reason: 'Correção fictícia de centavos',
      })
      const adjusted = await getStatement(admin, {
        recipientId: recipients['Distribuição E'],
        processId: p1,
      })
      expect(adjusted.totals.closingBalanceCents).toBe(159_000)
    })

    test('CT-17 consulta por data mostra o que foi efetivamente pago no dia', async () => {
      const day = await getStatement(admin, {
        recipientId: recipients['Distribuição F'],
        dateFrom: YESTERDAY,
        dateTo: YESTERDAY,
      })
      expect(day.totals.paidCents).toBe(10_000)
      expect(day.entries.every((e) => e.date === YESTERDAY)).toBe(true)
      const csv = await exportStatementCsv(admin, {
        recipientId: recipients['Distribuição F'],
      })
      expect(csv.startsWith('﻿Data;Tipo;Recebedor')).toBe(true)
      expect(csv).toContain('R$ 2.398,80')
    })

    test('CT-18 rastreabilidade: extrato → crédito → fechamento → memória → regra → recebimento → processo', async () => {
      const statement = await getStatement(admin, {
        recipientId: recipients['Colaborador A'],
      })
      const entry = statement.entries[0]
      expect(entry?.kind).toBe('CREDITO')
      const [credit] = await db
        .select()
        .from(financeCredit)
        .where(eq(financeCredit.id, entry?.creditId as string))
      const [line] = await db
        .select()
        .from(financeClosingLine)
        .where(eq(financeClosingLine.id, credit?.closingLineId as string))
      const [closing] = await db
        .select()
        .from(financeClosing)
        .where(eq(financeClosing.id, line?.closingId as string))
      const [rule] = await db
        .select()
        .from(financeRule)
        .where(eq(financeRule.id, line?.ruleId as string))
      const detail = await getReceiptDetail(admin, line?.receiptId as string)
      expect(line?.code).toBe('E.1')
      expect(line?.formula).toBe('C × 3,00% = R$ 9.600,00 × 3,00%')
      expect(closing?.code).toBe(entry?.closingCode as string)
      expect(rule?.id).toBe(manualRules.get('A') as string)
      expect(rule?.version).toBe(entry?.ruleVersion as number)
      expect(detail.receipt.id).toBe(firstReceiptId)
      expect(detail.process.id).toBe(p1)
      expect(detail.history.map((h) => h.action)).toEqual([
        'CRIADO',
        'BLOQUEADO',
        'PREVIA_CALCULADA',
        'APROVADO',
      ])
    })

    test('CT-15 gasto real reduz a reserva e não a receita', async () => {
      const creditsBefore = await listCredits(admin, { closingId })
      await createReserveDebit(admin, {
        idempotencyKey: key('mov'),
        poolKey: 'reserva-de-teste',
        processId: p1,
        kind: 'DESPESA',
        amountCents: 18_000,
        movementDate: '2026-09-25',
        description: 'Certidão em cartório (teste)',
      })
      await createReserveDebit(admin, {
        idempotencyKey: key('mov'),
        poolKey: 'reserva-de-teste',
        processId: p1,
        kind: 'TRANSFERENCIA',
        amountCents: 10_000,
        movementDate: '2026-09-26',
        description: 'Transferência do saldo (teste)',
        destination: 'Conta fictícia',
      })
      const reserve = (
        await reserveProcessBalances(admin, 'reserva-de-teste')
      ).find((r) => r.processId === p1)
      expect(reserve?.balanceCents).toBe(22_000)
      await expectFinanceError(
        createReserveDebit(admin, {
          idempotencyKey: key('mov'),
          poolKey: 'reserva-de-teste',
          processId: p1,
          kind: 'DESPESA',
          amountCents: 22_001,
          movementDate: '2026-09-27',
          description: 'Acima do saldo',
        }),
        422,
        /excede/,
      )
      await expectFinanceError(
        createReserveDebit(admin, {
          idempotencyKey: key('mov'),
          poolKey: 'inexistente',
          kind: 'DESPESA',
          amountCents: 1,
          movementDate: '2026-09-27',
          description: 'Sem origem',
        }),
        404,
        /sem origem/,
      )
      // receita/creditos do fechamento continuam iguais
      const creditsAfter = await listCredits(admin, { closingId })
      expect(creditsAfter.map((c) => c.amountCents)).toEqual(
        creditsBefore.map((c) => c.amountCents),
      )
      const [closing] = await db
        .select()
        .from(financeClosing)
        .where(eq(financeClosing.id, closingId))
      expect(closing?.grossCents).toBe(1_200_000)
      // estorno do fechamento bloqueado: ha baixas ativas e reserva consumida
      await expectFinanceError(
        reverseClosing(admin, closingId, 'Tentativa (teste)'),
        409,
      )
    })

    test('CT-03 / INV-10 importação equivalente ao cadastro manual', async () => {
      const csv = [
        'COLABORADOR;TRABALHO;BASE;PERCENTUAL;VALOR FIXO;VIGÊNCIA INÍCIO;VIGÊNCIA FIM;CONDOMÍNIOS;NATUREZA;RESERVA;UNICIDADE;ORDEM',
        ';Provisão;A;20;;01/01/2025;;Condomínio Teste 2;;Provisão de teste;;',
        'Colaborador A;;C;3;;01/01/2025;;Condomínio Teste 2;;;;1',
        'Colaborador B;;C;2;;01/01/2025;;Condomínio Teste 2;;;;2',
        ';;C;4;;01/01/2025;;Condomínio Teste 2;PROVISAO;Despesa percentual;;3',
        'Colaborador C;;C;2,5;;01/01/2025;;Condomínio Teste 2;;;;4',
        ';;I;;500,00;01/01/2025;;Condomínio Teste 2;;Reserva de teste;ÚNICA POR PROCESSO;',
        'Parceiro D;;J;50;;01/01/2025;;Condomínio Teste 2;;;;',
        'Distribuição E;;M;40;;01/01/2025;;Condomínio Teste 2;;;;1',
        'Distribuição F;;M;60;;01/01/2025;;Condomínio Teste 2;;;;2',
      ].join('\n')
      const file = {
        bytes: new TextEncoder().encode(csv),
        name: 'config-teste.csv',
      }
      const rulesBefore = (await listRules(admin)).length
      const preview = await previewImport(admin, file)
      expect(preview.mappingErrors).toEqual([])
      expect(preview.summary).toMatchObject({ total: 9, valid: 9, invalid: 0 })
      expect(preview.summary.newRecipients).toEqual([]) // reutiliza por nome exato
      expect((await listRules(admin)).length).toBe(rulesBefore) // nada gravado
      const confirmed = await confirmImport(admin, file, preview.mapping)
      const replay = await confirmImport(admin, file, preview.mapping)
      expect(replay.replayed).toBe(true)
      expect(replay.batch?.id).toBe(confirmed.batch?.id as string)
      const rules = await listRules(admin)
      expect(rules.filter((r) => r.origin === 'IMPORTACAO')).toHaveLength(9)

      // mesmo cliente/data/valor: manual (cond. 1) x importado (cond. 2)
      const manual = await newReceipt(
        admin,
        await createProcess(ids.cond1),
        1_234_567,
      )
      const imported = await newReceipt(
        admin,
        await createProcess(ids.cond2),
        1_234_567,
      )
      const a = steps(await calculateReceipt(admin, manual.id))
      const b = steps(await calculateReceipt(admin, imported.id))
      expect(a.length).toBeGreaterThan(0)
      expect(b.map((s) => [s.code, s.amountCents, s.formula])).toEqual(
        a.map((s) => [s.code, s.amountCents, s.formula]),
      )
      // CT-13: nenhuma regra do outro condominio foi aplicada
      const importedIds = new Set(
        rules.filter((r) => r.origin === 'IMPORTACAO').map((r) => r.id),
      )
      expect(a.some((s) => s.ruleId && importedIds.has(s.ruleId))).toBe(false)
      expect(b.every((s) => !s.ruleId || importedIds.has(s.ruleId))).toBe(true)
      // CT-14: frações de centavo reconciliadas
      const allocated = a
        .filter((s) => s.isAllocation)
        .reduce((sum, s) => sum + s.amountCents, 0)
      expect(allocated).toBe(1_234_567)
      expect(stepAmount(a, 'P')).toBe(0)
      // importacao invalida nao grava nada
      const bad = {
        bytes: new TextEncoder().encode(
          `${csv.split('\n')[0]}\nX;;Z;abc;;31/02/2026;;Inexistente;;;;`,
        ),
        name: 'ruim.csv',
      }
      const badPreview = await previewImport(admin, bad)
      expect(badPreview.summary.invalid).toBe(1)
      expect(badPreview.rows[0]?.errors.join(' ')).toMatch(/Base inválida/)
      await expectFinanceError(
        confirmImport(admin, bad, badPreview.mapping),
        422,
      )
    })

    test('CT-06 / CT-07 0% explícito é válido; parâmetro ausente bloqueia', async () => {
      const zeroProv = await createRule(admin, {
        stage: 'PROVISAO_RECEITA',
        nature: 'PROVISAO',
        poolLabel: 'Provisão zero',
        valueType: 'PERCENTUAL',
        basisPoints: 0,
        validFrom: '2025-01-01',
        housingComplexIds: [ids.cond3],
      })
      expect(zeroProv?.basisPoints).toBe(0)
      await createRule(admin, {
        stage: 'DISTRIBUICAO_FINAL',
        nature: 'CREDITO',
        recipientId: recipients['Distribuição E'],
        valueType: 'PERCENTUAL',
        basisPoints: 10_000,
        validFrom: '2025-01-01',
        housingComplexIds: [ids.cond3, ids.cond4],
      })
      const ok = await calculateReceipt(
        admin,
        (await newReceipt(admin, await createProcess(ids.cond3), 100_000)).id,
      )
      expect(ok?.status).toBe('EM_PREVIA')
      expect(stepAmount(steps(ok), 'B')).toBe(0)
      expect(stepAmount(steps(ok), 'N.1')).toBe(100_000)

      await createRule(admin, {
        stage: 'PROVISAO_RECEITA',
        nature: 'PROVISAO',
        poolLabel: 'Provisão pendente',
        valueType: 'PERCENTUAL',
        basisPoints: null,
        validFrom: '2025-01-01',
        housingComplexIds: [ids.cond4],
      })
      const blocked = await calculateReceipt(
        admin,
        (await newReceipt(admin, await createProcess(ids.cond4), 100_000)).id,
      )
      expect(blocked?.status).toBe('BLOQUEADO')
      const blocks = (
        blocked?.lastCalculation as { blocks: { code: string }[] }
      ).blocks
      expect(blocks.map((b) => b.code)).toContain('PARAMETRO_NAO_CONFIGURADO')
    })

    test('CT-11 nova versão não altera fechamento antigo', async () => {
      const lineageA = manualRules.get('A') as string
      const v2 = await createRuleVersion(admin, lineageA, {
        stage: 'DEDUCAO_LIQUIDA',
        nature: 'CREDITO',
        recipientId: recipients['Colaborador A'],
        valueType: 'PERCENTUAL',
        basisPoints: 350,
        sortOrder: 1,
        validFrom: '2026-06-01',
        housingComplexIds: [ids.cond1],
      })
      expect(v2?.version).toBe(2)
      const [v1] = await db
        .select()
        .from(financeRule)
        .where(eq(financeRule.id, lineageA))
      expect(v1?.validTo).toBe('2026-05-31')
      // fechamento antigo continua com 3% e a versao 1
      const detail = await getClosingDetail(admin, closingId)
      const oldLine = (
        detail.items[0]?.calculation as { steps: FinanceCalcStep[] }
      ).steps.find((s) => s.code === 'E.1')
      expect(oldLine).toMatchObject({
        basisPoints: 300,
        ruleVersion: 1,
        amountCents: 28_800,
      })
      // cliente cadastrado depois da nova vigencia usa 3,5%; antes, 3%
      const late = await createProcess(
        ids.cond1,
        new Date('2026-07-01T15:00:00Z'),
      )
      const newer = steps(
        await calculateReceipt(
          admin,
          (await newReceipt(admin, late, 1_200_000)).id,
        ),
      )
      expect(newer.find((s) => s.code === 'E.1')).toMatchObject({
        basisPoints: 350,
        ruleVersion: 2,
        amountCents: 33_600,
      })
      const early = steps(
        await calculateReceipt(
          admin,
          (await newReceipt(admin, await createProcess(ids.cond1), 1_200_000))
            .id,
        ),
      )
      expect(early.find((s) => s.code === 'E.1')).toMatchObject({
        basisPoints: 300,
        ruleVersion: 1,
      })
      // versao publicada e imutavel no banco
      await expectDbFailure(
        db.execute(
          sql`UPDATE finance_rule SET basis_points = 999 WHERE id = ${lineageA}`,
        ),
      )
    })

    test('idempotência de recebimento e mudança de dados após a prévia', async () => {
      const processId = await createProcess(ids.cond1)
      const body = {
        idempotencyKey: key('rec'),
        processId,
        kind: 'SUCUMBENCIA' as const,
        amountCents: 700_000,
        releaseDate: '2026-09-05',
      }
      const [x, y] = await Promise.all([
        createReceipt(admin, body),
        createReceipt(admin, body),
      ])
      expect(x.receipt.id).toBe(y.receipt.id)
      await expectFinanceError(
        createReceipt(admin, { ...body, amountCents: 700_001 }),
        409,
        /idempotência/,
      )
      // aprovar exige que nada tenha mudado desde a previa
      await calculateReceipt(admin, x.receipt.id)
      await createRule(admin, {
        stage: 'DEDUCAO_LIQUIDA',
        nature: 'CREDITO',
        recipientId: recipients['Colaborador B'],
        workType: 'Liderança',
        valueType: 'PERCENTUAL',
        basisPoints: 100,
        validFrom: '2025-01-01',
        housingComplexIds: [ids.cond1],
      })
      await expectFinanceError(
        approveReceipt(admin, x.receipt.id),
        409,
        /recalcule/,
      )
    })

    test('permissões no servidor: sem acesso, leitura por condomínio e operações globais', async () => {
      await expectFinanceError(listReceipts(noAccess, {}), 403)
      await expectFinanceError(getOverview(noAccess), 403)
      const visible = await listReceipts(viewer, {})
      expect(visible.length).toBeGreaterThan(0)
      expect(
        visible.every((r) => r.housingComplexName === 'Condomínio Teste 2'),
      ).toBe(true)
      await expectFinanceError(getReceiptDetail(viewer, firstReceiptId), 404)
      await expectFinanceError(
        createRule(viewer, {
          stage: 'PROVISAO_RECEITA',
          nature: 'PROVISAO',
          poolLabel: 'x',
          valueType: 'PERCENTUAL',
          basisPoints: 1,
          validFrom: '2030-01-01',
          housingComplexIds: [ids.cond2],
        }),
        403,
      )
      await expectFinanceError(
        createReceipt(viewer, {
          idempotencyKey: key('rec'),
          processId: p1,
          kind: 'MULTA',
          amountCents: 1,
        }),
        403,
      )
      const statement = await getStatement(viewer, {})
      expect(
        statement.entries.every(
          (e) => e.housingComplexName === 'Condomínio Teste 2',
        ),
      ).toBe(true)
    })

    test('comprovantes privados: upload validado, download íntegro e escopo', async () => {
      const { uploadAttachment, listAttachments, downloadAttachment } =
        await import('./finance.attachments.service')
      const pdf = new TextEncoder().encode('%PDF-1.4\n% comprovante ficticio\n')
      let attachment: { id: string } | undefined
      try {
        attachment = await uploadAttachment(
          admin,
          { kind: 'receipt', id: firstReceiptId },
          {
            bytes: pdf,
            name: 'comprovante-teste.pdf',
            type: 'application/pdf',
          },
        )
      } catch (error) {
        if ((error as ServiceError).statusCode === 503) {
          console.warn('S3 local indisponível: teste de comprovantes pulado.')
          return
        }
        throw error
      }
      const list = await listAttachments(admin, {
        kind: 'receipt',
        id: firstReceiptId,
      })
      expect(list.map((a) => a.id)).toContain(attachment?.id as string)
      const file = await downloadAttachment(admin, attachment?.id as string)
      expect(new TextDecoder().decode(file.bytes)).toBe(
        new TextDecoder().decode(pdf),
      )
      // conteudo que nao e PDF declarado como PDF: recusado pela assinatura
      await expectFinanceError(
        uploadAttachment(
          admin,
          { kind: 'receipt', id: firstReceiptId },
          {
            bytes: new TextEncoder().encode('<script>'),
            name: 'x.pdf',
            type: 'application/pdf',
          },
        ),
        415,
      )
      // fora do escopo (condominio 1): nem lista nem baixa
      await expectFinanceError(
        downloadAttachment(viewer, attachment?.id as string),
        404,
      )
      await expectFinanceError(
        listAttachments(viewer, { kind: 'receipt', id: firstReceiptId }),
        404,
      )
      await expectFinanceError(
        downloadAttachment(noAccess, attachment?.id as string),
        403,
      )
    })

    test('exclusão de processo: bloqueada com financeiro, preservada sem', async () => {
      const { deleteProcess } = await import('../processes/processes.service')
      await expectFinanceError(
        deleteProcess(p1),
        409,
        /lançamentos financeiros|lancamentos financeiros/,
      )
      await expectDbFailure(
        db.delete(processTable).where(eq(processTable.id, p1)),
      )
      const empty = await createProcess(ids.cond1)
      await db.delete(processTable).where(eq(processTable.id, empty))
    })
  },
)
