import { describe, expect, test } from 'bun:test'
import { nextConsultaStatus } from './quitacao-consulta'

describe('nextConsultaStatus — desfecho por CPF', () => {
  test('quitado sem falha de anexo -> quitado (terminal)', () => {
    expect(
      nextConsultaStatus('quitado', { attachFailed: false, exhausted: false }),
    ).toBe('quitado')
  })

  test('quitado com falha de anexo e ainda ha tentativas -> pending (reprocessa, NAO perde a quitacao)', () => {
    expect(
      nextConsultaStatus('quitado', { attachFailed: true, exhausted: false }),
    ).toBe('pending')
  })

  test('quitado com falha de anexo e tentativas esgotadas -> erro (nao loopa eternamente)', () => {
    expect(
      nextConsultaStatus('quitado', { attachFailed: true, exhausted: true }),
    ).toBe('erro')
  })

  test('nao_encontrado e sempre terminal', () => {
    expect(
      nextConsultaStatus('nao_encontrado', {
        attachFailed: false,
        exhausted: false,
      }),
    ).toBe('nao_encontrado')
  })

  test('erro transitorio com tentativas restantes -> pending', () => {
    expect(
      nextConsultaStatus('erro', { attachFailed: false, exhausted: false }),
    ).toBe('pending')
  })

  test('erro com tentativas esgotadas -> erro terminal', () => {
    expect(
      nextConsultaStatus('erro', { attachFailed: false, exhausted: true }),
    ).toBe('erro')
  })
})
