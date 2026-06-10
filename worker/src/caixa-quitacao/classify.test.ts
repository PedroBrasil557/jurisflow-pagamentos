import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyConsultaQuitacao } from './classify.ts'

test('botao Emitir habilitado e visivel => quitado', () => {
  const r = classifyConsultaQuitacao({
    emitButtonEnabled: true,
    emitButtonVisible: true,
    resultMessage: 'Parabens, seu contrato ja esta quitado!',
  })
  assert.equal(r.result, 'quitado')
})

test('botao off + mensagem "nao foi encontrado contrato" => nao_encontrado', () => {
  const r = classifyConsultaQuitacao({
    emitButtonEnabled: false,
    emitButtonVisible: false,
    resultMessage:
      'Prezado(a) cliente, No momento, nao foi encontrado contrato que atenda aos criterios para quitacao.',
  })
  assert.equal(r.result, 'nao_encontrado')
})

test('com acento: "nao foi encontrado" => nao_encontrado', () => {
  const r = classifyConsultaQuitacao({
    emitButtonEnabled: false,
    emitButtonVisible: false,
    resultMessage: 'não foi encontrado contrato',
  })
  assert.equal(r.result, 'nao_encontrado')
})

test('botao off + mensagem desconhecida => erro', () => {
  const r = classifyConsultaQuitacao({
    emitButtonEnabled: false,
    emitButtonVisible: false,
    resultMessage: 'Ocorreu um erro inesperado no servico.',
  })
  assert.equal(r.result, 'erro')
})

test('botao habilitado mas invisivel NAO conta como quitado', () => {
  const r = classifyConsultaQuitacao({
    emitButtonEnabled: true,
    emitButtonVisible: false,
    resultMessage: 'não foi encontrado contrato',
  })
  assert.equal(r.result, 'nao_encontrado')
})

test('mensagem vazia + botao off => erro', () => {
  const r = classifyConsultaQuitacao({
    emitButtonEnabled: false,
    emitButtonVisible: false,
    resultMessage: '',
  })
  assert.equal(r.result, 'erro')
})
