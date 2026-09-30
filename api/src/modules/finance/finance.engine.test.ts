import { describe, expect, test } from 'bun:test'
import {
  calculateBatch,
  calculateReceipt,
  creditStatusFor,
  type FinanceEngineRule,
  type FinanceReceiptCalculation,
  type FinanceReceiptInput,
  type FinanceReserveMovementInput,
  findRuleConflicts,
  normalizePoolKey,
  reserveBalance,
  uniqueReserveKey,
  validatePayout,
  validateReserveDebit,
  validateRuleShape,
} from './finance.engine'
import {
  exactPercentOfCents,
  formatBasisPoints,
  formatCentsBRL,
  parseBRLToCents,
  parsePercentToBasisPoints,
  percentOfCents,
} from './finance.money'

// FIXTURES DE TESTE (V3 §21, cenario TEST-001). Nomes e percentuais sao ficticios e
// existem SOMENTE aqui — nunca como configuracao do produto (INV-12).
// Valores esperados calculados A MAO a partir da especificacao.

const COND_1 = 'cond-teste-1'
const COND_2 = 'cond-teste-2'

function rule(
  partial: Partial<FinanceEngineRule> &
    Pick<FinanceEngineRule, 'id' | 'stage' | 'nature'>,
): FinanceEngineRule {
  return {
    lineageId: partial.id,
    version: 1,
    recipientId: null,
    recipientName: null,
    poolKey: null,
    poolLabel: null,
    workType: '',
    valueType: 'PERCENTUAL',
    basisPoints: null,
    fixedCents: null,
    sortOrder: 0,
    uniqueness: 'NENHUMA',
    validFrom: '2025-01-01',
    validTo: null,
    housingComplexIds: [COND_1],
    origin: 'MANUAL',
    ...partial,
  }
}

const credit = (
  id: string,
  name: string,
  stage: FinanceEngineRule['stage'],
  bps: number,
  order = 0,
) =>
  rule({
    id,
    stage,
    nature: 'CREDITO',
    recipientId: `rec-${id}`,
    recipientName: name,
    basisPoints: bps,
    sortOrder: order,
  })

const TEST_001_RULES: FinanceEngineRule[] = [
  rule({
    id: 'prov',
    stage: 'PROVISAO_RECEITA',
    nature: 'PROVISAO',
    poolKey: 'provisao-teste',
    poolLabel: 'Provisão de teste',
    basisPoints: 2000,
  }),
  credit('part-a', 'Colaborador A', 'DEDUCAO_LIQUIDA', 300, 1),
  credit('part-b', 'Colaborador B', 'DEDUCAO_LIQUIDA', 200, 2),
  rule({
    id: 'desp',
    stage: 'DEDUCAO_LIQUIDA',
    nature: 'PROVISAO',
    poolKey: 'despesa-percentual',
    poolLabel: 'Despesa percentual',
    basisPoints: 400,
    sortOrder: 3,
  }),
  credit('part-c', 'Colaborador C', 'DEDUCAO_LIQUIDA', 250, 4),
  rule({
    id: 'res',
    stage: 'RESERVA',
    nature: 'RESERVA',
    poolKey: 'reserva-teste',
    poolLabel: 'Reserva de teste',
    valueType: 'VALOR_FIXO',
    fixedCents: 50_000,
    uniqueness: 'UNICA_POR_PROCESSO',
  }),
  credit('parceiro-d', 'Parceiro D', 'PARTICIPACAO_RESULTADO', 5000),
  credit('dist-e', 'Distribuição E', 'DISTRIBUICAO_FINAL', 4000, 1),
  credit('dist-f', 'Distribuição F', 'DISTRIBUICAO_FINAL', 6000, 2),
]

function receipt(
  partial: Partial<FinanceReceiptInput> = {},
): FinanceReceiptInput {
  return {
    receiptId: 'r1',
    processId: 'p1',
    housingComplexId: COND_1,
    clientRegistrationDate: '2026-03-10',
    grossCents: 1_200_000,
    releaseDate: '2026-09-01',
    createdAt: '2026-09-01T12:00:00.000Z',
    ...partial,
  }
}

function calc(
  rules: FinanceEngineRule[] = TEST_001_RULES,
  partial: Partial<FinanceReceiptInput> = {},
  constituted: Set<string> = new Set(),
) {
  return calculateReceipt({
    receipt: receipt(partial),
    rules,
    constitutedUniqueReserves: constituted,
  })
}

const step = (c: FinanceReceiptCalculation, code: string) =>
  c.steps.find((s) => s.code === code)?.amountCents

const byRecipient = (c: FinanceReceiptCalculation, name: string) =>
  c.steps
    .filter((s) => s.isAllocation && s.recipientName === name)
    .reduce((sum, s) => sum + s.amountCents, 0)

describe('TEST-001 (V3 §21): R$ 12.000,00', () => {
  const c = calc()

  test('sequencia A–P reproduz a especificacao', () => {
    expect(c.blocked).toBe(false)
    expect(step(c, 'A')).toBe(1_200_000)
    expect(step(c, 'B')).toBe(240_000)
    expect(step(c, 'C')).toBe(960_000)
    expect(step(c, 'E.1')).toBe(28_800) // 3% de 9.600
    expect(step(c, 'E.2')).toBe(19_200) // 2%
    expect(step(c, 'E.3')).toBe(38_400) // 4%
    expect(step(c, 'E.4')).toBe(24_000) // 2,5%
    expect(step(c, 'I.1')).toBe(50_000)
    expect(step(c, 'D')).toBe(160_400)
    expect(step(c, 'J')).toBe(799_600)
    expect(step(c, 'L.1')).toBe(399_800)
    expect(step(c, 'M')).toBe(399_800)
    expect(step(c, 'N.1')).toBe(159_920)
    expect(step(c, 'N.2')).toBe(239_880)
    expect(step(c, 'P')).toBe(0)
  })

  test('parcelas somam a receita total e totais por natureza', () => {
    const allocated = c.steps
      .filter((s) => s.isAllocation)
      .reduce((sum, s) => sum + s.amountCents, 0)
    expect(allocated).toBe(1_200_000)
    expect(c.totals).toMatchObject({
      A: 1_200_000,
      P: 0,
      provisionsCents: 240_000 + 38_400,
      reservesCents: 50_000,
      creditsCents: 28_800 + 19_200 + 24_000 + 399_800 + 159_920 + 239_880,
    })
  })

  test('memoria guarda base, formula, versao e arredondamento por etapa', () => {
    const e1 = c.steps.find((s) => s.code === 'E.1')
    expect(e1).toMatchObject({
      baseKey: 'C',
      baseCents: 960_000,
      ruleId: 'part-a',
      ruleVersion: 1,
      basisPoints: 300,
      exactCents: '28800.0000',
      rounding: 'EXATO',
      nature: 'CREDITO',
      recipientName: 'Colaborador A',
    })
    expect(e1?.formula).toBe('C × 3,00% = R$ 9.600,00 × 3,00%')
    expect(c.steps.map((s) => s.order)).toEqual(
      c.steps.map((_, index) => index + 1),
    )
    expect(c.uniqueReserveKeys).toEqual([
      uniqueReserveKey('reserva-teste', 'p1'),
    ])
  })

  test('INV-11: renomear recebedores nao muda nenhum valor', () => {
    const renamed = TEST_001_RULES.map((r) => ({
      ...r,
      recipientName: r.recipientName ? `Outra pessoa ${r.id}` : null,
      recipientId: r.recipientId ? `outro-${r.id}` : null,
    }))
    const other = calc(renamed)
    expect(other.steps.map((s) => s.amountCents)).toEqual(
      c.steps.map((s) => s.amountCents),
    )
  })

  test('ordem das regras na entrada nao altera o resultado', () => {
    const reversed = calc([...TEST_001_RULES].reverse())
    expect(reversed.steps).toEqual(c.steps)
  })
})

describe('sistema vazio e bloqueios (CT-01, CT-05, CT-07)', () => {
  test('sem nenhuma regra: BLOQUEADO, sem valores inventados', () => {
    const c = calc([])
    expect(c.blocked).toBe(true)
    expect(c.blocks[0]?.code).toBe('SEM_REGRA_APLICAVEL')
    expect(c.steps).toEqual([])
    expect(c.totals).toBeNull()
  })

  test('parametro ausente (percentual nulo) bloqueia com causa e correcao', () => {
    const rules = TEST_001_RULES.map((r) =>
      r.id === 'part-b' ? { ...r, basisPoints: null } : r,
    )
    const c = calc(rules)
    expect(c.blocked).toBe(true)
    expect(c.blocks).toContainEqual(
      expect.objectContaining({
        code: 'PARAMETRO_NAO_CONFIGURADO',
        ruleId: 'part-b',
      }),
    )
    expect(c.blocks[0]?.fix).toBeTruthy()
  })

  test('etapa obrigatoria sem regra bloqueia', () => {
    const c = calc(TEST_001_RULES.filter((r) => r.stage !== 'PROVISAO_RECEITA'))
    expect(c.blocks.map((b) => b.code)).toContain('ETAPA_OBRIGATORIA_SEM_REGRA')
  })

  test('vigencia e condominio incompatíveis tem causas especificas', () => {
    expect(
      calc(TEST_001_RULES, { clientRegistrationDate: '2024-12-31' }).blocks[0]
        ?.code,
    ).toBe('VIGENCIA_INCOMPATIVEL')
    expect(
      calc(TEST_001_RULES, { housingComplexId: COND_2 }).blocks[0]?.code,
    ).toBe('CONDOMINIO_INCOMPATIVEL')
  })

  test('dados minimos do recebimento', () => {
    const c = calc(TEST_001_RULES, {
      grossCents: 0,
      releaseDate: null,
      clientRegistrationDate: null,
      housingComplexId: null,
    })
    expect(c.blocks.map((b) => b.code).sort()).toEqual([
      'DATA_CADASTRO_AUSENTE',
      'DATA_LIBERACAO_AUSENTE',
      'PROCESSO_SEM_CONDOMINIO',
      'VALOR_INVALIDO',
    ])
  })

  test('distribuicao final que nao soma 100% e inconsistente (INV-09)', () => {
    const rules = TEST_001_RULES.map((r) =>
      r.id === 'dist-f' ? { ...r, basisPoints: 5999 } : r,
    )
    expect(calc(rules).blocks[0]?.code).toBe('DISTRIBUICAO_FINAL_INCONSISTENTE')
  })

  test('deducoes acima da receita liquida bloqueiam (nunca saldo inexistente)', () => {
    const c = calc(TEST_001_RULES, { grossCents: 50_000 })
    expect(c.blocks[0]?.code).toBe('RESULTADO_NEGATIVO')
  })

  test('duas versoes aplicaveis do mesmo contexto: ambigua, nunca escolhe', () => {
    const dup = {
      ...TEST_001_RULES[1],
      id: 'part-a-v2',
      lineageId: 'part-a',
    } as FinanceEngineRule
    expect(calc([...TEST_001_RULES, dup]).blocks[0]?.code).toBe('REGRA_AMBIGUA')
  })
})

describe('0% explicito (CT-06, INV-04)', () => {
  test('0% configurado e valido e gera parcela zero registrada', () => {
    const rules = TEST_001_RULES.map((r) =>
      r.id === 'part-b' ? { ...r, basisPoints: 0 } : r,
    )
    const c = calc(rules)
    expect(c.blocked).toBe(false)
    expect(step(c, 'E.2')).toBe(0)
    expect(step(c, 'J')).toBe(818_800)
    expect(step(c, 'P')).toBe(0)
  })

  test('provisao obrigatoria em 0% satisfaz a etapa', () => {
    const rules = TEST_001_RULES.map((r) =>
      r.id === 'prov' ? { ...r, basisPoints: 0 } : r,
    )
    const c = calc(rules)
    expect(c.blocked).toBe(false)
    expect(step(c, 'B')).toBe(0)
    expect(step(c, 'C')).toBe(1_200_000)
  })

  test('valor fixo zero configurado tambem e valido', () => {
    const rules = TEST_001_RULES.map((r) =>
      r.id === 'res' ? { ...r, fixedCents: 0 } : r,
    )
    expect(calc(rules).blocked).toBe(false)
  })
})

describe('reserva unica e segundo recebimento (CT-08, INV-05)', () => {
  test('lote: primeiro recebimento constitui; segundo nao duplica', () => {
    const batch = calculateBatch({
      receipts: [
        receipt({
          receiptId: 'r2',
          releaseDate: '2026-09-15',
          createdAt: '2026-09-15T00:00:00Z',
        }),
        receipt({ receiptId: 'r1' }),
      ],
      rules: TEST_001_RULES,
      constitutedUniqueReserves: new Set(),
    })
    const [first, second] = batch.receipts
    expect(first?.receiptId).toBe('r1')
    expect(first && step(first, 'I.1')).toBe(50_000)
    expect(second && step(second, 'I.1')).toBe(0)
    expect(second?.steps.find((s) => s.code === 'I.1')?.note).toContain(
      'INV-05',
    )
    expect(second && step(second, 'J')).toBe(849_600)
    expect(second && step(second, 'N.1')).toBe(169_920)
    expect(second && step(second, 'N.2')).toBe(254_880)
    expect(second?.uniqueReserveKeys).toEqual([])
  })

  test('reserva ja constituida em fechamento anterior', () => {
    const c = calc(
      TEST_001_RULES,
      {},
      new Set([uniqueReserveKey('reserva-teste', 'p1')]),
    )
    expect(step(c, 'I.1')).toBe(0)
  })

  test('outro processo constitui a sua propria reserva', () => {
    const c = calc(
      TEST_001_RULES,
      { processId: 'p2' },
      new Set([uniqueReserveKey('reserva-teste', 'p1')]),
    )
    expect(step(c, 'I.1')).toBe(50_000)
  })
})

describe('multiplos recebedores e escopo (CT-12, CT-13, INV-02, INV-03)', () => {
  test('varios participantes na mesma etapa somam', () => {
    const c = calc()
    const deducoes = c.steps.filter((s) => s.kind === 'DEDUCAO_LIQUIDA')
    expect(deducoes).toHaveLength(4)
    expect(
      byRecipient(c, 'Colaborador A') + byRecipient(c, 'Colaborador B'),
    ).toBe(48_000)
  })

  test('regra fora do condominio nao e aplicada', () => {
    const rules = TEST_001_RULES.map((r) =>
      r.id === 'part-c' ? { ...r, housingComplexIds: [COND_2] } : r,
    )
    const c = calc(rules)
    expect(byRecipient(c, 'Colaborador C')).toBe(0)
    expect(c.steps.some((s) => s.ruleId === 'part-c')).toBe(false)
  })

  test('regra global e herdada por qualquer condominio do processo', () => {
    const globalRules = TEST_001_RULES.map((r) => ({
      ...r,
      housingComplexIds: [],
    }))
    const c = calc(globalRules, { housingComplexId: COND_2 })
    expect(c.blocked).toBe(false)
    expect(step(c, 'A')).toBe(1_200_000)
    expect(step(c, 'P')).toBe(0)
  })

  test('vigencia inclusiva nas bordas pela data de cadastro', () => {
    const limited = TEST_001_RULES.map((r) =>
      r.id === 'part-c'
        ? { ...r, validFrom: '2026-03-10', validTo: '2026-03-10' }
        : r,
    )
    expect(byRecipient(calc(limited), 'Colaborador C')).toBe(24_000)
    expect(
      byRecipient(
        calc(limited, { clientRegistrationDate: '2026-03-11' }),
        'Colaborador C',
      ),
    ).toBe(0)
    expect(
      byRecipient(
        calc(limited, { releaseDate: '2030-01-01' }),
        'Colaborador C',
      ),
    ).toBe(24_000)
  })
})

describe('arredondamento e centavos (CT-14)', () => {
  test('meio para cima por regra; residuo da distribuicao final pelo maior resto', () => {
    const c = calc(
      TEST_001_RULES,
      { grossCents: 333 },
      new Set([uniqueReserveKey('reserva-teste', 'p1')]),
    )
    expect(c.blocked).toBe(false)
    expect(step(c, 'B')).toBe(67)
    expect(step(c, 'C')).toBe(266)
    expect(step(c, 'E.1')).toBe(8)
    expect(step(c, 'E.2')).toBe(5)
    expect(step(c, 'E.3')).toBe(11)
    expect(step(c, 'E.4')).toBe(7)
    expect(step(c, 'J')).toBe(235)
    expect(step(c, 'L.1')).toBe(118)
    expect(step(c, 'M')).toBe(117)
    const n1 = c.steps.find((s) => s.code === 'N.1')
    expect(n1?.amountCents).toBe(47)
    expect(n1?.rounding).toBe('MAIOR_RESTO')
    expect(n1?.note).toContain('Centavo residual')
    expect(step(c, 'N.2')).toBe(70)
    expect(step(c, 'P')).toBe(0)
  })

  test('invariante em 3.000 valores aleatorios: parcelas = A e P = 0', () => {
    let seed = 7
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed
    }
    const thirds = [
      ...TEST_001_RULES.filter((r) => r.stage !== 'DISTRIBUICAO_FINAL'),
      credit('t1', 'T1', 'DISTRIBUICAO_FINAL', 3333, 1),
      credit('t2', 'T2', 'DISTRIBUICAO_FINAL', 3333, 2),
      credit('t3', 'T3', 'DISTRIBUICAO_FINAL', 3334, 3),
    ]
    for (let i = 0; i < 3000; i += 1) {
      const gross = 100_000 + (next() % 90_000_000)
      const c = calc(thirds, { grossCents: gross })
      expect(c.blocked).toBe(false)
      expect(step(c, 'P')).toBe(0)
      const allocated = c.steps
        .filter((s) => s.isAllocation)
        .reduce((sum, s) => sum + s.amountCents, 0)
      expect(allocated).toBe(gross)
    }
  })
})

describe('configuracao: forma e sobreposicao', () => {
  test('forma valida de TEST-001', () => {
    for (const r of TEST_001_RULES) expect(validateRuleShape(r)).toEqual([])
  })

  test('erros de forma e escopo global valido', () => {
    const [prov] = TEST_001_RULES as [FinanceEngineRule]
    expect(validateRuleShape({ ...prov, nature: 'CREDITO' })).toContain(
      'Natureza incompatível com a etapa.',
    )
    expect(validateRuleShape({ ...prov, housingComplexIds: [] })).toEqual([])
    expect(validateRuleShape({ ...prov, basisPoints: 10_001 })).toContain(
      'Percentual deve estar entre 0,00% e 100,00%.',
    )
    expect(validateRuleShape({ ...prov, basisPoints: 0 })).toEqual([])
    expect(validateRuleShape({ ...prov, basisPoints: null })).toEqual([])
  })

  test('mesmo contexto com condominio e vigencia sobrepostos conflita', () => {
    const [, partA] = TEST_001_RULES as [FinanceEngineRule, FinanceEngineRule]
    const candidate = {
      ...partA,
      id: 'novo',
      lineageId: 'novo',
      housingComplexIds: [COND_2, COND_1],
      validFrom: '2026-06-01',
    }
    expect(findRuleConflicts(candidate, TEST_001_RULES)).toHaveLength(1)
    expect(findRuleConflicts(candidate, TEST_001_RULES, 'part-a')).toHaveLength(
      0,
    )
    expect(
      findRuleConflicts(
        { ...candidate, housingComplexIds: [COND_2] },
        TEST_001_RULES,
      ),
    ).toHaveLength(0)
    expect(
      findRuleConflicts(
        { ...candidate, workType: 'Liderança' },
        TEST_001_RULES,
      ),
    ).toHaveLength(0)
  })

  test('escopo global conflita com regra especifica do mesmo contexto', () => {
    const [, partA] = TEST_001_RULES as [FinanceEngineRule, FinanceEngineRule]
    const global = {
      ...partA,
      id: 'global',
      lineageId: 'global',
      housingComplexIds: [],
      validFrom: '2026-06-01',
    }
    expect(findRuleConflicts(global, TEST_001_RULES)).toHaveLength(1)
  })
})

describe('reservas, creditos e baixas', () => {
  test('CT-15: 500 -> gasto 180 -> 320 -> transferencia 100 -> 220', () => {
    const movements: FinanceReserveMovementInput[] = [
      { kind: 'CONSTITUICAO', amountCents: 50_000 },
    ]
    expect(validateReserveDebit(reserveBalance(movements), 18_000)).toBeNull()
    movements.push({ kind: 'DESPESA', amountCents: 18_000 })
    expect(reserveBalance(movements)).toBe(32_000)
    movements.push({ kind: 'TRANSFERENCIA', amountCents: 10_000 })
    expect(reserveBalance(movements)).toBe(22_000)
    expect(validateReserveDebit(22_000, 22_001)).toContain('excede')
    expect(
      reserveBalance([
        ...movements,
        { kind: 'DESPESA', amountCents: 1, reversed: true },
      ]),
    ).toBe(22_000)
  })

  test('estado do credito e validacao de baixa (CT-09, CT-10, INV-06)', () => {
    expect(creditStatusFor(159_920, 0)).toBe('ABERTO')
    expect(creditStatusFor(159_920, 100_000)).toBe('PARCIALMENTE_PAGO')
    expect(creditStatusFor(159_920, 159_920)).toBe('PAGO')
    expect(validatePayout(159_920, 100_000, 59_920)).toBeNull()
    expect(validatePayout(159_920, 100_000, 59_921)).toContain('excede')
    expect(validatePayout(159_920, 0, 0)).toContain('maior que zero')
    expect(validatePayout(159_920, 0, -1)).toContain('maior que zero')
  })
})

describe('dinheiro e formatos', () => {
  test('percentual exato com resto', () => {
    expect(exactPercentOfCents(399_800, 4000)).toEqual({
      floorCents: 159_920,
      remainder: 0,
      roundedCents: 159_920,
      exact: '159920.0000',
    })
    expect(exactPercentOfCents(117, 4000)).toMatchObject({
      floorCents: 46,
      remainder: 8000,
      roundedCents: 47,
    })
    expect(percentOfCents(9_000_000_000_000_001, 3333)).toBe(
      2_999_700_000_000_000,
    )
  })

  test('parse e formatacao pt-BR', () => {
    expect(parsePercentToBasisPoints('2,5')).toBe(250)
    expect(parsePercentToBasisPoints('2.50%')).toBe(250)
    expect(parsePercentToBasisPoints('0')).toBe(0)
    expect(parsePercentToBasisPoints('100')).toBe(10_000)
    expect(parsePercentToBasisPoints('100,01')).toBeNull()
    expect(parsePercentToBasisPoints('2,555')).toBeNull()
    expect(parsePercentToBasisPoints('')).toBeNull()
    expect(parseBRLToCents('R$ 12.000,00')).toBe(1_200_000)
    expect(parseBRLToCents('1.2')).toBeNull()
    expect(formatCentsBRL(159_920)).toBe('R$ 1.599,20')
    expect(formatBasisPoints(250)).toBe('2,50%')
    expect(normalizePoolKey(' Certidão  Cartório ')).toBe('certidao-cartorio')
  })
})
