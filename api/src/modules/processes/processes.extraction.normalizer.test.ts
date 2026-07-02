import { describe, expect, test } from 'bun:test'
import { normalizeExtraction } from './processes.extraction.normalizer'

function fieldsByKey(raw: Parameters<typeof normalizeExtraction>[0]) {
  return Object.fromEntries(
    normalizeExtraction(raw).fields.map((f) => [f.key, f]),
  )
}

describe('normalizeExtraction — conjuge (termo de entrega)', () => {
  test('conjuge com nome+cpf+data marca spouseContractSigned=sim e preenche os dados', () => {
    const byKey = fieldsByKey({
      conjuge: {
        fullName: 'Maria da Silva',
        cpf: '11144477735', // CPF valido
        birthDate: '1990-05-15',
      },
    })

    expect(byKey.spouseContractSigned?.value).toBe('sim')
    expect(byKey.spouseContractSigned?.valid).toBe(true)
    expect(byKey.spouseSameAddress?.value).toBe('sim')
    expect(byKey.spouseFullName?.value).toBe('MARIA DA SILVA')
    expect(byKey.spouseCpf?.valid).toBe(true)
    expect(byKey.spouseBirthDate?.value).toBe('1990-05-15')
    expect(byKey.spouseBirthDate?.valid).toBe(true)
  })

  test('sem conjuge nao produz nenhum campo de conjuge', () => {
    const byKey = fieldsByKey({ titular: { fullName: 'Joao' } })
    expect(Object.keys(byKey).some((k) => k.startsWith('spouse'))).toBe(false)
  })

  test('conjuge sem identidade (so confianca) e ignorado', () => {
    const byKey = fieldsByKey({ conjuge: { confianca: 0.9 } })
    expect(Object.keys(byKey).some((k) => k.startsWith('spouse'))).toBe(false)
  })

  test('cpf do conjuge invalido vem com valid=false (mas o flag continua sim)', () => {
    const byKey = fieldsByKey({
      conjuge: { fullName: 'Maria', cpf: '11111111111' },
    })
    expect(byKey.spouseContractSigned?.value).toBe('sim')
    expect(byKey.spouseCpf?.valid).toBe(false)
  })

  test('data de nascimento do conjuge invalida (calendario) vem com valid=false', () => {
    const byKey = fieldsByKey({
      conjuge: { fullName: 'Maria', birthDate: '2024-02-31' },
    })
    expect(byKey.spouseBirthDate?.valid).toBe(false)
  })
})
