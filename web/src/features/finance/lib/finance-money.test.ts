import { describe, expect, test } from 'vitest'
import * as api from '../../../../../api/src/modules/finance/finance.money'
import {
  formatBasisPoints,
  formatCents,
  formatCivilDate,
  instantToCivil,
  parseBRLToCents,
  parsePercentToBasisPoints,
} from './finance-money'

// Paridade web x API (V3 §22: a mesma regra no front e no back). O modulo da API
// e importado apenas neste teste, nunca no bundle.
describe('finance-money: paridade com a API', () => {
  test('formatacao de centavos e percentuais identica', () => {
    const samples = [
      0, 1, 5, 99, 100, 159_920, 1_200_000, 123_456_789, -104_592,
    ]
    for (const cents of samples)
      expect(formatCents(cents)).toBe(api.formatCentsBRL(cents))
    for (const bps of [0, 1, 5, 250, 2000, 10_000]) {
      expect(formatBasisPoints(bps)).toBe(api.formatBasisPoints(bps))
    }
  })

  test('parse identico, inclusive entradas invalidas', () => {
    const money = [
      'R$ 12.000,00',
      '12000,5',
      '180',
      '0,01',
      '1.2',
      'abc',
      '12,345',
      '1.000.000,99',
    ]
    for (const input of money)
      expect(parseBRLToCents(input)).toBe(api.parseBRLToCents(input))
    const percents = [
      '2,5',
      '2.50%',
      '0',
      '100',
      '100,01',
      '2,555',
      '',
      '33,33',
    ]
    for (const input of percents) {
      expect(parsePercentToBasisPoints(input)).toBe(
        api.parsePercentToBasisPoints(input),
      )
    }
  })

  test('0% explicito e diferente de nao configurado', () => {
    expect(formatBasisPoints(0)).toBe('0,00%')
    expect(formatBasisPoints(null)).toBe('não configurado')
    expect(formatCents(null)).toBe('—')
  })

  test('data civil sem fuso e instante convertido em Sao Paulo', () => {
    expect(formatCivilDate('2026-03-10')).toBe('10/03/2026')
    expect(instantToCivil('2026-10-02T01:30:00.000Z')).toBe('2026-10-01')
  })
})
