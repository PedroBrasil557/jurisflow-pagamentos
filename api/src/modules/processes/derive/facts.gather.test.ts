import { describe, expect, test } from 'bun:test'
import { mergeTermoCompradores } from './facts.gather'

const CPF_A = '52998224725'

describe('mergeTermoCompradores — dedup por nome normalizado', () => {
  test('mesmo nome com/sem acento funde em 1 (regressao do co-comprador fantasma)', () => {
    const merged = mergeTermoCompradores([
      { termoCompradores: [{ nome: 'José da Silva', cpf: CPF_A }] },
      { termoCompradores: [{ nome: 'JOSE DA SILVA' }] },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].cpf).toBe(CPF_A)
  })

  test('upgrade: a versao COM CPF substitui a sem CPF, em qualquer ordem', () => {
    const semCpfPrimeiro = mergeTermoCompradores([
      { termoCompradores: [{ nome: 'Maria Souza' }] },
      { termoCompradores: [{ nome: 'MARIA SOUZA', cpf: CPF_A }] },
    ])
    expect(semCpfPrimeiro).toHaveLength(1)
    expect(semCpfPrimeiro[0].cpf).toBe(CPF_A)
  })

  test('duas pessoas realmente distintas continuam separadas', () => {
    const merged = mergeTermoCompradores([
      {
        termoCompradores: [
          { nome: 'João Lima', cpf: CPF_A },
          { nome: 'Ana Costa', cpf: '11144477735' },
        ],
      },
    ])
    expect(merged).toHaveLength(2)
  })

  test('entradas sem nome sao ignoradas', () => {
    const merged = mergeTermoCompradores([
      { termoCompradores: [{ cpf: CPF_A }, { nome: '' }] },
    ])
    expect(merged).toHaveLength(0)
  })
})
