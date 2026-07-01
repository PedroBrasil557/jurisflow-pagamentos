import { describe, expect, test } from 'bun:test'
import { classifyAverbacao } from './averbacao'

// Fixtures SINTETICAS (sem PII) que reproduzem os dois templates reais da Caixa.
const POSITIVO =
  'Declaracao de Quitacao. Este documento comprova a quitacao do seu contrato ' +
  'habitacional. Para o procedimento de averbacao da liberacao da garantia na ' +
  'matricula do imovel junto ao cartorio, apresente esta declaracao.'

const NEGATIVO =
  'Declaracao de Quitacao. Este documento e uma declaracao de quitacao do seu ' +
  'contrato habitacional. Informamos que nao foi possivel emitir o termo de ' +
  'quitacao para averbacao da liberacao da garantia na matricula do imovel junto ' +
  'ao cartorio porque ha pendencias documentais no seu contrato.'

describe('classifyAverbacao', () => {
  test('template POSITIVO -> sim', () => {
    expect(classifyAverbacao(POSITIVO)).toBe('sim')
  })

  test('template POSITIVO com acentos/caixa/quebras -> sim', () => {
    const comAcento = POSITIVO.replace(
      'Para o procedimento de averbacao',
      'PARA O\n  PROCEDIMENTO DE AVERBAÇÃO',
    )
    expect(classifyAverbacao(comAcento)).toBe('sim')
  })

  test('template NEGATIVO (menciona averbacao, sem a frase) -> nao', () => {
    expect(classifyAverbacao(NEGATIVO)).toBe('nao')
  })

  test('texto vazio -> indeterminado (fail-closed)', () => {
    expect(classifyAverbacao('')).toBe('indeterminado')
    expect(classifyAverbacao('   ')).toBe('indeterminado')
  })

  test('texto sem mencao a averbacao (template desconhecido) -> indeterminado', () => {
    const outro =
      'Declaracao de quitacao do contrato habitacional. Documento meramente ' +
      'informativo, sem qualquer mencao ao procedimento em cartorio.'
    expect(classifyAverbacao(outro)).toBe('indeterminado')
  })
})
