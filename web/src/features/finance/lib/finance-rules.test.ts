import { describe, expect, test } from 'vitest'
import { ruleEffectiveOn, rulesEffectiveOn } from './finance-rules'

describe('finance-rules: vigência exibida na configuração', () => {
  const date = '2026-10-02'

  test('não trata versão histórica ATIVA como vigente hoje', () => {
    expect(
      ruleEffectiveOn(
        {
          status: 'ATIVA',
          validFrom: '2026-01-01',
          validTo: '2026-09-30',
        },
        date,
      ),
    ).toBe(false)
  })

  test('respeita bordas inclusivas e revogação', () => {
    expect(
      ruleEffectiveOn(
        { status: 'ATIVA', validFrom: date, validTo: date },
        date,
      ),
    ).toBe(true)
    expect(
      ruleEffectiveOn(
        { status: 'REVOGADA', validFrom: '2026-01-01', validTo: null },
        date,
      ),
    ).toBe(false)
  })

  test('mantém somente versões efetivamente vigentes', () => {
    const rules = [
      {
        id: 'v1',
        status: 'ATIVA',
        validFrom: '2026-01-01',
        validTo: '2026-09-30',
      },
      {
        id: 'v2',
        status: 'ATIVA',
        validFrom: '2026-10-01',
        validTo: null,
      },
      {
        id: 'v3',
        status: 'ATIVA',
        validFrom: '2027-01-01',
        validTo: null,
      },
    ]
    expect(rulesEffectiveOn(rules, date).map((rule) => rule.id)).toEqual(['v2'])
  })
})
