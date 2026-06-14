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

  test('CPFs validos diferentes => nao_titular, mesmo com nome igual (pai/filho)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Jose da Silva', cpf: CPF_OUTRO })],
      titular,
    )
    expect(r).toEqual({ result: 'nao_titular', matchedBy: 'none' })
  })

  test('sem CPF + nome identico (acento/caixa) => titular (matchedBy name)', () => {
    const r = compareCaixaOwner([buyer({ nome: 'JOSÉ DA SILVA' })], titular)
    expect(r).toEqual({ result: 'titular', matchedBy: 'name' })
  })

  test('sem CPF + nome diferente => review (nome-so e sinal fraco, nao impoe nao_titular)', () => {
    const r = compareCaixaOwner([buyer({ nome: 'Maria Souza' })], titular)
    expect(r).toEqual({ result: 'review', matchedBy: 'none' })
  })

  test('titular com CPF valido + comprador com CPF valido diferente => nao_titular (confirmado)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Maria Souza', cpf: CPF_OUTRO })],
      titular,
    )
    expect(r).toEqual({ result: 'nao_titular', matchedBy: 'none' })
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

  // D5: um CPF presente porem invalido/mascarado e um sinal de identidade
  // conflitante -> NAO cai no nome (evita falso match por homonimo).
  test('CPF mascarado (LGPD) + nome igual => review, nao cai no nome (D5)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Jose da Silva', cpf: '111.444.***-**' })],
      titular,
    )
    expect(r).toEqual({ result: 'review', matchedBy: 'none' })
  })

  test('CPF invalido (zeros) + nome igual => review, nao cai no nome (D5)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Jose da Silva', cpf: '000.000.000-00' })],
      titular,
    )
    expect(r).toEqual({ result: 'review', matchedBy: 'none' })
  })

  // D6: CPF com digitos a mais (ex.: colado a um telefone) nao casa por truncagem.
  test('CPF do titular com digitos extras => nao casa por CPF nem nome (D6)', () => {
    const r = compareCaixaOwner(
      [buyer({ nome: 'Jose da Silva', cpf: `${CPF_TITULAR} 99887766` })],
      titular,
    )
    expect(r).toEqual({ result: 'review', matchedBy: 'none' })
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

  // v3 — colapso 2 estados: o co-comprador/conjuge e tratado como comprador do
  // termo (mesma lista). Basta o titular do processo bater com QUALQUER comprador.
  test('titular bate com o 2o comprador (co-comprador) por CPF => titular', () => {
    const r = compareCaixaOwner(
      [
        buyer({ nome: 'Outra Pessoa', cpf: CPF_OUTRO }),
        buyer({ nome: 'Qualquer Nome', cpf: '111.444.777-35' }),
      ],
      titular,
    )
    expect(r).toEqual({ result: 'titular', matchedBy: 'cpf' })
  })

  test('titular nao consta entre os compradores, CPF confirmado => nao_titular', () => {
    const r = compareCaixaOwner(
      [
        buyer({ nome: 'Maria Souza', cpf: CPF_OUTRO }),
        buyer({ nome: 'Outro Comprador', cpf: CPF_OUTRO }),
      ],
      titular,
    )
    expect(r).toEqual({ result: 'nao_titular', matchedBy: 'none' })
  })
})
