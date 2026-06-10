import { describe, expect, test } from 'bun:test'
import { buildAiAnalysisRow } from './ai-analysis.row'

describe('buildAiAnalysisRow', () => {
  test('preenche os campos e aplica defaults nulos nos opcionais', () => {
    const row = buildAiAnalysisRow({
      kind: 'caixa_owner',
      processId: 'proc_1',
      model: 'claude-opus-4-8',
      promptVersion: 'caixa_owner@1',
      status: 'ok',
      triggerSource: 'system',
    })

    expect(row.kind).toBe('caixa_owner')
    expect(row.processId).toBe('proc_1')
    expect(row.model).toBe('claude-opus-4-8')
    expect(row.promptVersion).toBe('caixa_owner@1')
    expect(row.status).toBe('ok')
    expect(row.triggerSource).toBe('system')
    // Opcionais ausentes viram null explicito (nao undefined).
    expect(row.context).toBeNull()
    expect(row.input).toBeNull()
    expect(row.output).toBeNull()
    expect(row.decision).toBeNull()
    expect(row.confidence).toBeNull()
    expect(row.errorMessage).toBeNull()
    expect(row.tokensInput).toBeNull()
    expect(row.tokensOutput).toBeNull()
    expect(row.durationMs).toBeNull()
    expect(row.triggeredByUserId).toBeNull()
  })

  test('gera um id quando ausente e respeita o id fornecido', () => {
    const generated = buildAiAnalysisRow({
      kind: 'caixa_owner',
      processId: 'proc_1',
      model: 'm',
      promptVersion: 'v',
      status: 'ok',
      triggerSource: 'system',
    })
    expect(typeof generated.id).toBe('string')
    expect((generated.id as string).length).toBeGreaterThan(0)

    const fixed = buildAiAnalysisRow({
      id: 'fixed_id',
      kind: 'caixa_owner',
      processId: 'proc_1',
      model: 'm',
      promptVersion: 'v',
      status: 'ok',
      triggerSource: 'system',
    })
    expect(fixed.id).toBe('fixed_id')
  })

  test('preserva os campos de evidencia e a decisao quando fornecidos', () => {
    const row = buildAiAnalysisRow({
      kind: 'caixa_owner',
      processId: 'proc_1',
      model: 'm',
      promptVersion: 'v',
      status: 'ok',
      triggerSource: 'user',
      triggeredByUserId: 'user_9',
      confidence: 92,
      tokensInput: 1200,
      tokensOutput: 80,
      durationMs: 3400,
      context: {
        documentKey: 'declaracao_quitacao',
        fileId: 'f_1',
        revision: 2,
      },
      output: { compradores: [{ nome: 'X', cpf: '11111111111' }] },
      decision: { result: 'titular', matchedBy: 'cpf' },
    })

    expect(row.triggerSource).toBe('user')
    expect(row.triggeredByUserId).toBe('user_9')
    expect(row.confidence).toBe(92)
    expect(row.tokensInput).toBe(1200)
    expect(row.context).toEqual({
      documentKey: 'declaracao_quitacao',
      fileId: 'f_1',
      revision: 2,
    })
    expect(row.decision).toEqual({ result: 'titular', matchedBy: 'cpf' })
  })

  test('registra falha como status error com a mensagem', () => {
    const row = buildAiAnalysisRow({
      kind: 'caixa_owner',
      processId: 'proc_1',
      model: 'm',
      promptVersion: 'v',
      status: 'error',
      errorMessage: 'timeout do modelo',
      triggerSource: 'system',
    })
    expect(row.status).toBe('error')
    expect(row.errorMessage).toBe('timeout do modelo')
  })
})
