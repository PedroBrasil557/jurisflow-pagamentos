import { describe, expect, test } from 'bun:test'
import {
  allocatePayout,
  assignCertidaoReserves,
  calculateBatch,
  calculateReceipt,
  type FinanceEngineRule,
  type FinanceReceiptCalculation,
  type FinanceReceiptInput,
  findRuleConflicts,
  reserveBalance,
  validateReserveDebit,
  validateRuleShape,
} from './finance.engine'
import {
  formatBasisPoints,
  formatCentsBRL,
  parseBRLToCents,
  percentOfCents,
} from './finance.money'

// Valores esperados calculados A MAO (ver comentarios), nao pelo algoritmo.
// Pessoas e percentuais: cascata DEMONSTRATIVA, nao homologada.

const CONJ_A = 'conj-a'
const CONJ_B = 'conj-b'

function rule(
  partial: Partial<FinanceEngineRule> &
    Pick<FinanceEngineRule, 'id' | 'role' | 'recipientId'>,
): FinanceEngineRule {
  return {
    revision: 1,
    recipientName: partial.recipientId,
    housingComplexId: null,
    validFrom: '2020-01-01',
    validTo: null,
    basisPoints: null,
    cascadeOrder: null,
    ...partial,
  }
}

// Ivanildo so no conjunto A; os demais valem para todos.
const CASCADE: FinanceEngineRule[] = [
  rule({
    id: 'r-ivanildo',
    role: 'DISTRIBUICAO',
    recipientId: 'ivanildo',
    recipientName: 'Ivanildo',
    housingComplexId: CONJ_A,
    basisPoints: 5000,
    cascadeOrder: 1,
  }),
  rule({
    id: 'r-wilomar',
    role: 'DISTRIBUICAO',
    recipientId: 'wilomar',
    recipientName: 'Wilomar',
    basisPoints: 6000,
    cascadeOrder: 2,
  }),
  rule({
    id: 'r-gean',
    role: 'DISTRIBUICAO',
    recipientId: 'gean',
    recipientName: 'Gean',
    basisPoints: 4000,
    cascadeOrder: 3,
  }),
  rule({
    id: 'r-inova',
    role: 'DISTRIBUICAO_SALDO',
    recipientId: 'inova',
    recipientName: 'Inova',
  }),
]

function receipt(
  partial: Partial<FinanceReceiptInput> = {},
): FinanceReceiptInput {
  return {
    receiptId: 'rec-1',
    processId: 'proc-1',
    housingComplexId: CONJ_A,
    grossCents: 1_200_000,
    participationReferenceDate: '2026-03-10',
    distributionReferenceDate: '2026-09-01',
    createdAt: '2026-09-01T12:00:00.000Z',
    ...partial,
  }
}

function amountOf(calc: FinanceReceiptCalculation, recipientId: string) {
  return calc.lines
    .filter((line) => line.recipientId === recipientId)
    .reduce((sum, line) => sum + line.amountCents, 0)
}

function sumLines(calc: FinanceReceiptCalculation) {
  return calc.lines.reduce((sum, line) => sum + line.amountCents, 0)
}

describe('caso de referencia R$ 12.000,00', () => {
  const calc = calculateReceipt({
    receipt: receipt(),
    rules: CASCADE,
    appliesCertidaoReserve: true,
  })

  test('rubricas', () => {
    expect(calc.blocked).toBe(false)
    expect(calc.grossCents).toBe(1_200_000)
    expect(calc.taxProvisionCents).toBe(240_000) // 20% de 12.000
    expect(calc.netCents).toBe(960_000)
    expect(calc.participationsCents).toBe(0)
    expect(calc.supportProvisionCents).toBe(38_400) // 4% de 9.600
    expect(calc.certidaoReserveCents).toBe(50_000)
    expect(calc.distributableBaseCents).toBe(871_600) // 9600-384-500
  })

  test('cascata demonstrativa', () => {
    expect(amountOf(calc, 'ivanildo')).toBe(435_800) // 50% de 8.716
    expect(amountOf(calc, 'wilomar')).toBe(261_480) // 60% de 4.358
    expect(amountOf(calc, 'gean')).toBe(69_728) // 40% de 1.743,20
    expect(amountOf(calc, 'inova')).toBe(104_592) // saldo 1.045,92
  })

  test('invariante: soma das rubricas = bruto, em centavos', () => {
    expect(sumLines(calc)).toBe(1_200_000)
    expect(
      calc.taxProvisionCents +
        calc.participationsCents +
        calc.supportProvisionCents +
        calc.certidaoReserveCents +
        calc.distributionCents,
    ).toBe(calc.grossCents)
  })

  test('memoria de calculo reproduzivel e legivel', () => {
    expect(calc.memory).toContain(
      'Tributo provisionado = 20,00% x R$ 12.000,00 = R$ 2.400,00',
    )
    expect(calc.memory.join('\n')).toContain(
      'Base distribuivel = R$ 9.600,00 - R$ 0,00 - R$ 384,00 - R$ 500,00 = R$ 8.716,00',
    )
    const again = calculateReceipt({
      receipt: receipt(),
      rules: [...CASCADE].reverse(),
      appliesCertidaoReserve: true,
    })
    expect(again.lines).toEqual(calc.lines)
    expect(again.memory).toEqual(calc.memory)
  })

  test('sem Ivanildo aplicavel, cascata sobre a base integral', () => {
    const noIvanildo = calculateReceipt({
      receipt: receipt({ housingComplexId: CONJ_B }),
      rules: CASCADE,
      appliesCertidaoReserve: true,
    })
    expect(amountOf(noIvanildo, 'ivanildo')).toBe(0)
    expect(amountOf(noIvanildo, 'wilomar')).toBe(522_960) // 60% de 8.716
    expect(amountOf(noIvanildo, 'gean')).toBe(139_456) // 40% de 3.486,40
    expect(amountOf(noIvanildo, 'inova')).toBe(209_184) // 2.091,84
    expect(sumLines(noIvanildo)).toBe(1_200_000)
  })
})

describe('reserva unica de certidao', () => {
  test('segundo recebimento do mesmo processo nao cria outra reserva', () => {
    const batch = calculateBatch({
      receipts: [
        receipt({
          receiptId: 'rec-2',
          distributionReferenceDate: '2026-09-15',
          createdAt: '2026-09-15T10:00:00.000Z',
        }),
        receipt({ receiptId: 'rec-1' }),
      ],
      rules: CASCADE,
      processIdsWithReserve: new Set(),
    })
    const [first, second] = batch.receipts
    expect(first?.receiptId).toBe('rec-1') // mais antigo leva a reserva
    expect(first?.certidaoReserveCents).toBe(50_000)
    expect(second?.receiptId).toBe('rec-2')
    expect(second?.certidaoReserveCents).toBe(0)
    // 2o: base = 9600 - 384 = 9216 -> Ivanildo 4608; Wilomar 2764,80; Gean 737,28; Inova 1105,92
    expect(second?.distributableBaseCents).toBe(921_600)
    expect(second && amountOf(second, 'ivanildo')).toBe(460_800)
    expect(second && amountOf(second, 'wilomar')).toBe(276_480)
    expect(second && amountOf(second, 'gean')).toBe(73_728)
    expect(second && amountOf(second, 'inova')).toBe(110_592)
    expect(batch.totals.certidaoReserveCents).toBe(50_000)
    expect(batch.totals.grossCents).toBe(2_400_000)
    expect(
      batch.totals.taxProvisionCents +
        batch.totals.participationsCents +
        batch.totals.supportProvisionCents +
        batch.totals.certidaoReserveCents +
        batch.totals.distributionCents,
    ).toBe(2_400_000)
  })

  test('processo com reserva ja constituida em fechamento anterior: zero', () => {
    const reserved = assignCertidaoReserves(
      [
        receipt({ receiptId: 'a' }),
        receipt({ receiptId: 'b', processId: 'p2' }),
      ],
      new Set(['proc-1']),
    )
    expect([...reserved]).toEqual(['b'])
  })

  test('desempate deterministico por data, criacao e id', () => {
    const same = {
      distributionReferenceDate: '2026-09-01',
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const reserved = assignCertidaoReserves(
      [
        receipt({ receiptId: 'z', ...same }),
        receipt({ receiptId: 'm', ...same }),
      ],
      new Set(),
    )
    expect([...reserved]).toEqual(['m'])
  })
})

describe('arredondamento', () => {
  test('meio para cima por rubrica e residuo no saldo final', () => {
    // bruto 3,33: tributo 66,6 -> 67; liquido 266; apoio 10,64 -> 11; base 255
    // Ivanildo 127,5 -> 128; saldo 127; Wilomar 76,2 -> 76; saldo 51;
    // Gean 20,4 -> 20; Inova 31.  67+11+128+76+20+31 = 333
    const calc = calculateReceipt({
      receipt: receipt({ grossCents: 333 }),
      rules: CASCADE,
      appliesCertidaoReserve: false,
    })
    expect(calc.taxProvisionCents).toBe(67)
    expect(calc.netCents).toBe(266)
    expect(calc.supportProvisionCents).toBe(11)
    expect(calc.distributableBaseCents).toBe(255)
    expect(amountOf(calc, 'ivanildo')).toBe(128)
    expect(amountOf(calc, 'wilomar')).toBe(76)
    expect(amountOf(calc, 'gean')).toBe(20)
    expect(amountOf(calc, 'inova')).toBe(31)
    expect(sumLines(calc)).toBe(333)
  })

  test('percentOfCents sem ponto flutuante em valores grandes', () => {
    // 9.000.000.000.000.001 x 3333 = 29.997.000.000.000.003.333 (> 2^64)
    // / 10000 = 2.999.700.000.000.000,3333 -> 2.999.700.000.000.000
    expect(percentOfCents(9_000_000_000_000_001, 3333)).toBe(
      2_999_700_000_000_000,
    )
    expect(() => percentOfCents(Number.MAX_SAFE_INTEGER + 2, 1)).toThrow()
    expect(percentOfCents(1, 5000)).toBe(1) // 0,5 centavo -> 1
    expect(percentOfCents(1, 4999)).toBe(0)
  })

  test('invariante vale para 5.000 valores aleatorios com participacoes', () => {
    const rules = [
      ...CASCADE,
      rule({
        id: 'r-wilamy',
        role: 'PARTICIPACAO',
        recipientId: 'wilamy',
        basisPoints: 333,
      }),
      rule({
        id: 'r-lider',
        role: 'LIDERANCA',
        recipientId: 'lider',
        basisPoints: 125,
      }),
      rule({
        id: 'r-prosp',
        role: 'PROSPECTADOR',
        recipientId: 'prosp',
        basisPoints: 77,
      }),
    ]
    let seed = 42
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed
    }
    // Com reserva, bruto de R$ 600 bloqueia (liquido 480 < 500): limite real.
    expect(
      calculateReceipt({
        receipt: receipt({ grossCents: 60_000 }),
        rules,
        appliesCertidaoReserve: true,
      }).blocked,
    ).toBe(true)
    for (let i = 0; i < 5000; i += 1) {
      const gross = 100_000 + (next() % 50_000_000)
      const calc = calculateReceipt({
        receipt: receipt({ grossCents: gross }),
        rules,
        appliesCertidaoReserve: i % 2 === 0,
      })
      expect(calc.blocked).toBe(false)
      expect(sumLines(calc)).toBe(gross)
      for (const line of calc.lines) {
        expect(Number.isSafeInteger(line.amountCents)).toBe(true)
        expect(line.amountCents).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('participacoes profissionais', () => {
  const rules = [
    ...CASCADE,
    rule({
      id: 'r-wilamy',
      role: 'PARTICIPACAO',
      recipientId: 'wilamy',
      recipientName: 'Wilamy',
      basisPoints: 250,
      validFrom: '2026-01-01',
      validTo: '2026-06-30',
    }),
    rule({
      id: 'r-lider',
      role: 'LIDERANCA',
      recipientId: 'lider',
      housingComplexId: CONJ_A,
      basisPoints: 100,
    }),
    rule({
      id: 'r-prosp',
      role: 'PROSPECTADOR',
      recipientId: 'prosp',
      basisPoints: 50,
    }),
  ]

  test('calculadas individualmente sobre o liquido', () => {
    // liquido 9.600: Wilamy 2,5% = 240; lider 1% = 96; prosp 0,5% = 48 -> 384
    // base = 9600 - 384 - 384 - 500 = 8.332; Ivanildo 4.166; Wilomar 2.499,60;
    // Gean 666,56; Inova 999,84
    const calc = calculateReceipt({
      receipt: receipt({ participationReferenceDate: '2026-06-30' }),
      rules,
      appliesCertidaoReserve: true,
    })
    expect(amountOf(calc, 'wilamy')).toBe(24_000)
    expect(amountOf(calc, 'lider')).toBe(9_600)
    expect(amountOf(calc, 'prosp')).toBe(4_800)
    expect(calc.participationsCents).toBe(38_400)
    expect(calc.distributableBaseCents).toBe(833_200)
    expect(amountOf(calc, 'ivanildo')).toBe(416_600)
    expect(amountOf(calc, 'wilomar')).toBe(249_960)
    expect(amountOf(calc, 'gean')).toBe(66_656)
    expect(amountOf(calc, 'inova')).toBe(99_984)
    expect(sumLines(calc)).toBe(1_200_000)
  })

  test('vigencia inclusiva e escopo de conjunto', () => {
    const afterEnd = calculateReceipt({
      receipt: receipt({
        participationReferenceDate: '2026-07-01',
        housingComplexId: CONJ_B,
      }),
      rules,
      appliesCertidaoReserve: false,
    })
    expect(amountOf(afterEnd, 'wilamy')).toBe(0) // vigencia terminou 30/06
    expect(amountOf(afterEnd, 'lider')).toBe(0) // lider so no conjunto A
    expect(amountOf(afterEnd, 'prosp')).toBe(4_800)
  })

  test('data ambigua e processo sem conjunto geram alerta nao bloqueante', () => {
    const calc = calculateReceipt({
      receipt: receipt({
        housingComplexId: null,
        referenceDateAmbiguous: true,
      }),
      rules,
      appliesCertidaoReserve: false,
    })
    expect(calc.blocked).toBe(false)
    expect(calc.alerts.map((alert) => alert.code).sort()).toEqual([
      'DATA_REFERENCIA_AMBIGUA',
      'PROCESSO_SEM_CONJUNTO',
    ])
  })
})

describe('bloqueios', () => {
  test('base negativa nao cria saldo inexistente', () => {
    // bruto 100: liquido 80, apoio 3,20, reserva 500 -> base negativa
    const calc = calculateReceipt({
      receipt: receipt({ grossCents: 10_000 }),
      rules: CASCADE,
      appliesCertidaoReserve: true,
    })
    expect(calc.blocked).toBe(true)
    expect(calc.lines).toHaveLength(0)
    expect(calc.alerts[0]?.code).toBe('BASE_NEGATIVA')
  })

  test('sem regra de saldo final', () => {
    const calc = calculateReceipt({
      receipt: receipt(),
      rules: CASCADE.filter((r) => r.role !== 'DISTRIBUICAO_SALDO'),
      appliesCertidaoReserve: true,
    })
    expect(calc.blocked).toBe(true)
    expect(calc.alerts[0]?.code).toBe('SEM_REGRA_SALDO')
  })

  test('ambiguidade aplicavel bloqueia em vez de escolher', () => {
    const calc = calculateReceipt({
      receipt: receipt(),
      rules: [
        ...CASCADE,
        rule({
          id: 'r-gean-2',
          role: 'DISTRIBUICAO',
          recipientId: 'outro',
          basisPoints: 1000,
          cascadeOrder: 3,
        }),
      ],
      appliesCertidaoReserve: true,
    })
    expect(calc.blocked).toBe(true)
    expect(calc.alerts.map((a) => a.code)).toContain('ORDEM_CASCATA_DUPLICADA')
  })

  test('valor zero ou fracionario e invalido', () => {
    for (const grossCents of [0, -1, 10.5]) {
      const calc = calculateReceipt({
        receipt: receipt({ grossCents }),
        rules: CASCADE,
        appliesCertidaoReserve: false,
      })
      expect(calc.blocked).toBe(true)
      expect(calc.alerts[0]?.code).toBe('VALOR_INVALIDO')
    }
  })

  test('lote com item bloqueado fica bloqueado e totais ignoram o item', () => {
    const batch = calculateBatch({
      receipts: [
        receipt({ receiptId: 'ok', processId: 'p-ok' }),
        receipt({ receiptId: 'ruim', processId: 'p-ruim', grossCents: 10_000 }),
      ],
      rules: CASCADE,
      processIdsWithReserve: new Set(),
    })
    expect(batch.blocked).toBe(true)
    expect(batch.totals.grossCents).toBe(1_200_000)
  })
})

describe('conflitos de regras', () => {
  const published = CASCADE

  test('mesma ordem de cascata com escopo "todos" x conjunto especifico conflita', () => {
    const candidate = rule({
      id: 'novo',
      role: 'DISTRIBUICAO',
      recipientId: 'x',
      housingComplexId: CONJ_B,
      basisPoints: 1000,
      cascadeOrder: 2,
      validFrom: '2026-01-01',
    })
    const conflicts = findRuleConflicts(candidate, published)
    expect(conflicts.map((c) => c.conflictingRuleId)).toEqual(['r-wilomar'])
  })

  test('mesma pessoa e papel com vigencias que se tocam no limite conflita', () => {
    const a = rule({
      id: 'a',
      role: 'LIDERANCA',
      recipientId: 'p',
      basisPoints: 100,
      validFrom: '2026-01-01',
      validTo: '2026-06-30',
    })
    const touching = { ...a, id: 'b', validFrom: '2026-06-30', validTo: null }
    const after = { ...a, id: 'c', validFrom: '2026-07-01', validTo: null }
    expect(findRuleConflicts(touching, [a])).toHaveLength(1)
    expect(findRuleConflicts(after, [a])).toHaveLength(0)
  })

  test('mesma pessoa com papeis diferentes nao conflita; conjuntos disjuntos nao conflitam', () => {
    const lider = rule({
      id: 'l',
      role: 'LIDERANCA',
      recipientId: 'p',
      housingComplexId: CONJ_A,
      basisPoints: 100,
    })
    const prosp = { ...lider, id: 'pr', role: 'PROSPECTADOR' as const }
    const liderB = { ...lider, id: 'lb', housingComplexId: CONJ_B }
    expect(findRuleConflicts(prosp, [lider])).toHaveLength(0)
    expect(findRuleConflicts(liderB, [lider])).toHaveLength(0)
  })

  test('nomes parecidos sao pessoas distintas (identidade por id)', () => {
    const wilamy = rule({
      id: 'w1',
      role: 'PARTICIPACAO',
      recipientId: 'id-wilamy',
      recipientName: 'Wilamy',
      basisPoints: 100,
    })
    const wila = {
      ...wilamy,
      id: 'w2',
      recipientId: 'id-wila',
      recipientName: 'Wila',
    }
    expect(findRuleConflicts(wila, [wilamy])).toHaveLength(0)
  })

  test('segundo saldo final sobreposto conflita', () => {
    const other = rule({
      id: 's2',
      role: 'DISTRIBUICAO_SALDO',
      recipientId: 'outro',
      housingComplexId: CONJ_A,
    })
    expect(findRuleConflicts(other, published)).toHaveLength(1)
  })

  test('forma da regra', () => {
    expect(
      validateRuleShape(
        rule({
          id: 'x',
          role: 'DISTRIBUICAO',
          recipientId: 'p',
          basisPoints: 100,
        }),
      ),
    ).toContain('Regra de distribuicao exige ordem inteira a partir de 1.')
    expect(
      validateRuleShape(
        rule({
          id: 'x',
          role: 'LIDERANCA',
          recipientId: 'p',
          basisPoints: 100,
          validFrom: '2026-02-01',
          validTo: '2026-01-31',
        }),
      ),
    ).toContain('O fim da vigencia deve ser igual ou posterior ao inicio.')
    expect(
      validateRuleShape(
        rule({ id: 'x', role: 'DISTRIBUICAO_SALDO', recipientId: 'p' }),
      ),
    ).toEqual([])
  })
})

describe('livro da reserva de certidao', () => {
  test('500 -> despesa 180 -> 320 -> transferencia 100 -> 220', () => {
    const movements = [{ kind: 'CONSTITUICAO' as const, amountCents: 50_000 }]
    expect(reserveBalance(movements)).toBe(50_000)
    expect(validateReserveDebit(reserveBalance(movements), 18_000)).toBeNull()
    movements.push({ kind: 'DESPESA' as never, amountCents: 18_000 })
    expect(reserveBalance(movements)).toBe(32_000)
    movements.push({ kind: 'TRANSFERENCIA' as never, amountCents: 10_000 })
    expect(reserveBalance(movements)).toBe(22_000)
  })

  test('debito acima do saldo e bloqueado; estorno nao conta', () => {
    expect(validateReserveDebit(22_000, 22_001)).toContain('excede o saldo')
    expect(validateReserveDebit(22_000, 22_000)).toBeNull()
    expect(validateReserveDebit(22_000, 0)).not.toBeNull()
    expect(
      reserveBalance([
        { kind: 'CONSTITUICAO', amountCents: 50_000 },
        { kind: 'DESPESA', amountCents: 18_000, reversed: true },
      ]),
    ).toBe(50_000)
  })
})

describe('alocacao de baixas', () => {
  const items = [
    { lineId: 'l1', outstandingCents: 10_000 },
    { lineId: 'l2', outstandingCents: 0 },
    { lineId: 'l3', outstandingCents: 5_000 },
  ]

  test('baixa parcial FIFO', () => {
    expect(allocatePayout(items, 12_000)).toEqual({
      ok: true,
      allocations: [
        { lineId: 'l1', amountCents: 10_000 },
        { lineId: 'l3', amountCents: 2_000 },
      ],
    })
  })

  test('baixa total e acima do saldo', () => {
    const total = allocatePayout(items, 15_000)
    expect(total.ok).toBe(true)
    const over = allocatePayout(items, 15_001)
    expect(over.ok).toBe(false)
    expect(allocatePayout(items, 0).ok).toBe(false)
  })
})

describe('formatacao pt-BR', () => {
  test('moeda e percentual', () => {
    expect(formatCentsBRL(104_592)).toBe('R$ 1.045,92')
    expect(formatCentsBRL(5)).toBe('R$ 0,05')
    expect(formatCentsBRL(-123_456_789)).toBe('-R$ 1.234.567,89')
    expect(formatBasisPoints(2000)).toBe('20,00%')
    expect(formatBasisPoints(5)).toBe('0,05%')
  })

  test('parse de moeda brasileira', () => {
    expect(parseBRLToCents('R$ 12.000,00')).toBe(1_200_000)
    expect(parseBRLToCents('12000,5')).toBe(1_200_050)
    expect(parseBRLToCents('180')).toBe(18_000)
    expect(parseBRLToCents('1.2')).toBeNull()
    expect(parseBRLToCents('abc')).toBeNull()
    expect(parseBRLToCents('12,345')).toBeNull()
  })
})
