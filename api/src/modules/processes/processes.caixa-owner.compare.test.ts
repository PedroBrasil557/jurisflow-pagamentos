import { describe, expect, test } from 'bun:test'
import { normalizeName } from '../../shared/utils/name'
import {
  type CaixaBuyer,
  compareCaixaOwner,
  decideCaixaOwnerOutcome,
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

  test('sem CPF + nome diferente => nao_titular (diferenca confirmada)', () => {
    const r = compareCaixaOwner([buyer({ nome: 'Maria Souza' })], titular)
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
})

describe('decideCaixaOwnerOutcome', () => {
  test('review => sempre revisar, nunca aplica', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'review',
      currentOwnerType: '',
      ownerTypeSource: 'human',
      autoApplyEnabled: true,
    })
    expect(o.apply).toBe(false)
    expect(o.analysisStatus).toBe('review')
    expect(o.historyEvent).toBe('CAIXA_OWNER_REVIEW_REQUIRED')
  })

  test('titular ja aplicado => no-op (done, sem evento)', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'titular',
      currentOwnerType: 'titular_contrato_caixa',
      ownerTypeSource: 'system',
      autoApplyEnabled: true,
    })
    expect(o).toEqual({
      analysisStatus: 'done',
      apply: false,
      historyEvent: null,
    })
  })

  test('shadow (flag off): titular detectado => revisar, sem aplicar', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'titular',
      currentOwnerType: '',
      ownerTypeSource: 'human',
      autoApplyEnabled: false,
    })
    expect(o.apply).toBe(false)
    expect(o.analysisStatus).toBe('review')
  })

  test('flag on + ownerType vazio => auto-aplica titular', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'titular',
      currentOwnerType: '',
      ownerTypeSource: 'human',
      autoApplyEnabled: true,
    })
    expect(o).toEqual({
      analysisStatus: 'done',
      apply: true,
      newOwnerType: 'titular_contrato_caixa',
      historyEvent: 'CAIXA_OWNER_AUTO_SET',
    })
  })

  test('human-lock: humano definiu "nao titular" => revisar, nao sobrescreve', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'titular',
      currentOwnerType: 'nao_titular_contrato_caixa',
      ownerTypeSource: 'human',
      autoApplyEnabled: true,
    })
    expect(o.apply).toBe(false)
    expect(o.analysisStatus).toBe('review')
    expect(o.historyEvent).toBe('CAIXA_OWNER_REVIEW_REQUIRED')
  })

  test('nao_titular + flag on + ownerType vazio => auto-aplica nao_titular', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'nao_titular',
      currentOwnerType: '',
      ownerTypeSource: 'human',
      autoApplyEnabled: true,
    })
    expect(o).toEqual({
      analysisStatus: 'done',
      apply: true,
      newOwnerType: 'nao_titular_contrato_caixa',
      historyEvent: 'CAIXA_OWNER_AUTO_SET',
    })
  })

  test('nao_titular ja aplicado => no-op', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'nao_titular',
      currentOwnerType: 'nao_titular_contrato_caixa',
      ownerTypeSource: 'system',
      autoApplyEnabled: true,
    })
    expect(o).toEqual({
      analysisStatus: 'done',
      apply: false,
      historyEvent: null,
    })
  })

  test('human-lock: humano definiu "titular" + analise nao_titular => revisar', () => {
    const o = decideCaixaOwnerOutcome({
      result: 'nao_titular',
      currentOwnerType: 'titular_contrato_caixa',
      ownerTypeSource: 'human',
      autoApplyEnabled: true,
    })
    expect(o.apply).toBe(false)
    expect(o.analysisStatus).toBe('review')
  })
})
