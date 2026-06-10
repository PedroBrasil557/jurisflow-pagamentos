import { describe, expect, test } from 'bun:test'
import { normalizeName } from '../../shared/utils/name'
import {
  type CaixaBuyer,
  compareCaixaOwner,
} from './processes.caixa-owner.compare'

// CPFs validos (checksum) e distintos para os testes.
const CPF_TITULAR = '11144477735'
const CPF_OUTRO = '52998224725'

const titular = { fullName: 'Jose da Silva', cpf: CPF_TITULAR }

function buyer(partial: Partial<CaixaBuyer> & { nome: string }): CaixaBuyer {
  return { cpf: null, ...partial }
}

describe('normalizeName', () => {
  test('remove acento, caixa e colapsa espacos', () => {
    expect(normalizeName('  José   da Silva ')).toBe('JOSE DA SILVA')
    expect(normalizeName('JOSÉ DA SILVA')).toBe('JOSE DA SILVA')
    expect(normalizeName('joão gonçalves')).toBe('JOAO GONCALVES')
  })
})

describe('compareCaixaOwner', () => {
  test('CPF identico => titular (matchedBy cpf)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Qualquer Nome', cpf: '111.444.777-35' })],
      titular,
    )
    expect(r).toEqual({ result: 'titular', matchedBy: 'cpf' })
  })

  test('CPFs validos diferentes => review, mesmo com nome igual (pai/filho)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Jose da Silva', cpf: CPF_OUTRO })],
      titular,
    )
    expect(r).toEqual({ result: 'review', matchedBy: 'none' })
  })

  test('sem CPF + nome identico (acento/caixa) => titular (matchedBy name)', () => {
    const r = compareCaixaOwner([buyer({ nome: 'JOSÉ DA SILVA' })], titular)
    expect(r).toEqual({ result: 'titular', matchedBy: 'name' })
  })

  test('sem CPF + nome diferente => review', () => {
    const r = compareCaixaOwner([buyer({ nome: 'Maria Souza' })], titular)
    expect(r).toEqual({ result: 'review', matchedBy: 'none' })
  })

  test('casal: basta um comprador bater por CPF', () => {
    const r = compareCaixaOwner(
      [
        buyer({ nome: 'Maria Souza', cpf: CPF_OUTRO }),
        buyer({ nome: 'Outro', cpf: '111.444.777-35' }),
      ],
      titular,
    )
    expect(r).toEqual({ result: 'titular', matchedBy: 'cpf' })
  })

  test('CPF do comprador invalido => cai no nome (e bate)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Jose da Silva', cpf: '000.000.000-00' })],
      titular,
    )
    expect(r).toEqual({ result: 'titular', matchedBy: 'name' })
  })

  test('lista vazia => review', () => {
    expect(compareCaixaOwner([], titular)).toEqual({
      result: 'review',
      matchedBy: 'none',
    })
  })

  test('match por CPF tem prioridade sobre divergencia de nome', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Nome Totalmente Diferente', cpf: CPF_TITULAR })],
      titular,
    )
    expect(r).toEqual({ result: 'titular', matchedBy: 'cpf' })
  })
})
