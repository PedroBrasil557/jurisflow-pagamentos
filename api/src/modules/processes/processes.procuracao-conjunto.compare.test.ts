import { describe, expect, test } from 'bun:test'
import {
  type ConjuntoRecord,
  matchConjuntoInAddress,
} from './processes.procuracao-conjunto.compare'

function conj(
  id: string,
  name: string,
  city: string | null = null,
): ConjuntoRecord {
  return { id, name, city }
}

const RESIDENCIAL_VILA_NOVA = conj('1', 'Residencial Vila Nova', 'Camacari')
const PARQUE_DAS_FLORES = conj('2', 'Parque das Flores', 'Salvador')

describe('matchConjuntoInAddress', () => {
  test('nome do conjunto no endereco => match', () => {
    const r = matchConjuntoInAddress(
      {
        addressText:
          'Rua das Acacias, 123, Residencial Vila Nova, Camacari - BA',
      },
      [RESIDENCIAL_VILA_NOVA, PARQUE_DAS_FLORES],
    )
    expect(r.result).toBe('match')
    expect(r.conjunto?.id).toBe('1')
    expect(r.matchedBy).toBe('name')
  })

  test('acentos/caixa normalizados => match', () => {
    const r = matchConjuntoInAddress(
      { addressText: 'Av. Brasil, 50, RESIDÊNCIAL VÍLA NOVA, Camaçari/BA' },
      [conj('1', 'Residencial Vila Nova')],
    )
    expect(r.result).toBe('match')
  })

  test('nome NAO aparece no endereco => review', () => {
    const r = matchConjuntoInAddress(
      { addressText: 'Rua X, 10, Centro, Camacari - BA' },
      [RESIDENCIAL_VILA_NOVA, PARQUE_DAS_FLORES],
    )
    expect(r.result).toBe('review')
    expect(r.matchedBy).toBe('none')
  })

  test('palavra incompleta NAO casa (substring solto) => review', () => {
    // "Parque das Flores" NAO deve casar em "Parque das Floresta"
    const r = matchConjuntoInAddress(
      { addressText: 'Rua do Parque das Floresta, 5' },
      [PARQUE_DAS_FLORES],
    )
    expect(r.result).toBe('review')
  })

  test('nome muito curto (< minimo) NAO casa, evita falso positivo', () => {
    const r = matchConjuntoInAddress({ addressText: 'Rua Sol, 12, Sol' }, [
      conj('9', 'Sol'),
    ])
    expect(r.result).toBe('review')
  })

  test('mesmo nome em cidades diferentes: cidade do endereco desambigua', () => {
    const r = matchConjuntoInAddress(
      { addressText: 'Rua A, 1, Bela Vista', addressCity: 'Salvador' },
      [
        conj('a', 'Bela Vista', 'Camacari'),
        conj('b', 'Bela Vista', 'Salvador'),
      ],
    )
    expect(r.result).toBe('match')
    expect(r.conjunto?.id).toBe('b')
    expect(r.matchedBy).toBe('name+city')
  })

  test('mesmo nome, cidade NAO desambigua => review (nunca chuta)', () => {
    const r = matchConjuntoInAddress(
      { addressText: 'Rua A, 1, Bela Vista', addressCity: 'Feira' },
      [
        conj('a', 'Bela Vista', 'Camacari'),
        conj('b', 'Bela Vista', 'Salvador'),
      ],
    )
    expect(r.result).toBe('review')
  })

  test('nome mais especifico (mais longo) vence quando ambos casam', () => {
    // O endereco contem "Residencial Vila Nova" (que contem "Vila Nova").
    const r = matchConjuntoInAddress(
      { addressText: 'Rua B, 2, Residencial Vila Nova, Camacari' },
      [conj('curto', 'Vila Nova'), conj('longo', 'Residencial Vila Nova')],
    )
    expect(r.result).toBe('match')
    expect(r.conjunto?.id).toBe('longo')
  })

  test('endereco vazio => review', () => {
    const r = matchConjuntoInAddress({ addressText: '' }, [
      RESIDENCIAL_VILA_NOVA,
    ])
    expect(r.result).toBe('review')
  })
})
