import { describe, expect, test } from 'bun:test'
import type { ProcessStatus } from '../processes.status'
import { DOC, deriveProcessState, deriveStatus } from './derive'
import type { CompraVenda, Fact, Person, ProcessFacts } from './facts.types'

// CPFs validos (checksum) para o match do compareCaixaOwner.
const CPF_A = '52998224725'
const CPF_B = '11144477735'
const titularA: Person = { nome: 'TITULAR A', cpf: CPF_A }
const buyerB: Person = { nome: 'COMPRADOR B', cpf: CPF_B }

const ready = <T>(value: T): Fact<T> => ({ state: 'ready', value })
const absent = <T>(): Fact<T> => ({ state: 'absent' })
const pending = <T>(): Fact<T> => ({ state: 'pending' })

const ALL_BASE = [DOC.procuracao, DOC.rgTitular, DOC.declaracao, DOC.honorarios]

// Baseline: titular_contrato_caixa COMPLETO (titular = comprador do termo).
function facts(overrides: Partial<ProcessFacts> = {}): ProcessFacts {
  const classified = new Set([...ALL_BASE, DOC.termoEntrega])
  const attached = new Set([...ALL_BASE, DOC.termoEntrega])
  return {
    classifiedTypes: ready(classified),
    attachedTypes: attached,
    hasOkWithoutFile: false,
    outorgantes: ready([titularA]),
    titularProcesso: ready([titularA]),
    termoCompradores: ready([titularA]),
    compraVenda: absent<CompraVenda>(),
    housingComplexLinked: true,
    currentStatus: 'EM_DOCUMENTACAO',
    ...overrides,
  }
}

describe('deriveStatus — lift fiel de reconcileProcessStatus', () => {
  const cases: Array<
    [string, Parameters<typeof deriveStatus>[0], ProcessStatus]
  > = [
    [
      'RASCUNHO sem docs -> CADASTRADO',
      {
        currentStatus: 'RASCUNHO',
        hasIndividualDocs: false,
        documentationComplete: false,
      },
      'CADASTRADO',
    ],
    [
      'RASCUNHO com docs -> EM_DOCUMENTACAO',
      {
        currentStatus: 'RASCUNHO',
        hasIndividualDocs: true,
        documentationComplete: false,
      },
      'EM_DOCUMENTACAO',
    ],
    [
      'EM_DOCUMENTACAO completo -> PRONTA',
      {
        currentStatus: 'EM_DOCUMENTACAO',
        hasIndividualDocs: true,
        documentationComplete: true,
      },
      'DOCUMENTACAO_PRONTA',
    ],
    [
      'EM_DOCUMENTACAO incompleto -> permanece',
      {
        currentStatus: 'EM_DOCUMENTACAO',
        hasIndividualDocs: true,
        documentationComplete: false,
      },
      'EM_DOCUMENTACAO',
    ],
    [
      'PRONTA incompleto -> reverte EM_DOCUMENTACAO',
      {
        currentStatus: 'DOCUMENTACAO_PRONTA',
        hasIndividualDocs: true,
        documentationComplete: false,
      },
      'EM_DOCUMENTACAO',
    ],
    [
      'PRONTA completo -> permanece',
      {
        currentStatus: 'DOCUMENTACAO_PRONTA',
        hasIndividualDocs: true,
        documentationComplete: true,
      },
      'DOCUMENTACAO_PRONTA',
    ],
    [
      'CADASTRADO completo NAO pula p/ PRONTA (two-step)',
      {
        currentStatus: 'CADASTRADO',
        hasIndividualDocs: true,
        documentationComplete: true,
      },
      'EM_DOCUMENTACAO',
    ],
    [
      'EM_PROCESSO intocado',
      {
        currentStatus: 'EM_PROCESSO',
        hasIndividualDocs: true,
        documentationComplete: true,
      },
      'EM_PROCESSO',
    ],
    [
      'FINALIZADO intocado',
      {
        currentStatus: 'FINALIZADO',
        hasIndividualDocs: false,
        documentationComplete: false,
      },
      'FINALIZADO',
    ],
  ]

  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(deriveStatus(input)).toBe(expected)
    })
  }
})

describe('deriveProcessState — Passo 1 (gate base)', () => {
  test('falta doc da base -> requiredDocs lista + nao completa', () => {
    const classified = new Set([
      DOC.procuracao,
      DOC.rgTitular,
      DOC.honorarios,
      DOC.termoEntrega,
    ]) // falta declaracao
    const attached = new Set([
      DOC.procuracao,
      DOC.rgTitular,
      DOC.honorarios,
      DOC.termoEntrega,
    ])
    const d = deriveProcessState(
      facts({ classifiedTypes: ready(classified), attachedTypes: attached }),
    )
    const keys = d.requiredDocs.flatMap((r) => r.keys)
    expect(keys).toContain(DOC.declaracao)
    // declaracao nao anexada -> nao avanca p/ PRONTA
    expect(d.status).toBe('EM_DOCUMENTACAO')
  })
})

describe('deriveProcessState — 2.1 ramo termo', () => {
  test('titular consta no termo -> titular_contrato_caixa + quitacao no titular', () => {
    const d = deriveProcessState(facts())
    expect(d.ownerType.value).toBe('titular_contrato_caixa')
    expect(d.quitacaoSubject?.cpf).toBe(CPF_A)
    // sem co-comprador, sem compra_venda exigida, completo -> PRONTA
    expect(d.status).toBe('DOCUMENTACAO_PRONTA')
  })

  test('titular NAO consta no termo -> nao_titular + exige compra_venda + quitacao no comprador do termo', () => {
    const d = deriveProcessState(
      facts({
        titularProcesso: ready([titularA]),
        termoCompradores: ready([buyerB]), // comprador != titular
      }),
    )
    expect(d.ownerType.value).toBe('nao_titular_contrato_caixa')
    expect(d.quitacaoSubject?.cpf).toBe(CPF_B) // titular Caixa = comprador do termo
    const keys = d.requiredDocs.flatMap((r) => r.keys)
    expect(keys).toContain(DOC.compraVenda)
    // compra_venda nao anexada -> pendente -> nao PRONTA
    expect(d.status).toBe('EM_DOCUMENTACAO')
  })
})

describe('deriveProcessState — 2.2 ramo compra e venda', () => {
  function compraVendaFacts(dataAssinatura: string): ProcessFacts {
    const classified = new Set([...ALL_BASE, DOC.termoEntrega, DOC.compraVenda])
    const attached = new Set([...ALL_BASE, DOC.termoEntrega, DOC.compraVenda])
    return facts({
      classifiedTypes: ready(classified),
      attachedTypes: attached,
      termoCompradores: ready([buyerB]),
      compraVenda: ready({
        vendedores: [buyerB],
        compradores: [titularA],
        dataAssinatura,
      }),
    })
  }

  test('compra e venda -> nao_titular + quitacao no vendedor; data valida -> PRONTA', () => {
    const d = deriveProcessState(compraVendaFacts('2024-01-10'))
    expect(d.ownerType.value).toBe('nao_titular_contrato_caixa')
    expect(d.quitacaoSubject?.cpf).toBe(CPF_B) // vendedor
    expect(d.reviewFlags).toHaveLength(0)
    expect(d.status).toBe('DOCUMENTACAO_PRONTA')
  })

  test('data de assinatura <= 26/09/2023 -> reviewFlag + bloqueia PRONTA', () => {
    const d = deriveProcessState(compraVendaFacts('2023-09-26'))
    expect(d.reviewFlags.join(' ')).toContain('fora do prazo')
    expect(d.status).toBe('EM_DOCUMENTACAO')
  })
})

describe('deriveProcessState — readiness (timing)', () => {
  test('classificacao em voo -> pending, NAO decide', () => {
    const d = deriveProcessState(
      facts({ classifiedTypes: pending<Set<string>>() }),
    )
    expect(d.readiness).toBe('pending')
    expect(d.pendingOn).toBe('classificando')
    expect(d.ownerType.value).toBe('')
    expect(d.status).not.toBe('DOCUMENTACAO_PRONTA')
  })

  test('sem termo e sem compra e venda -> undetermined (aguarda)', () => {
    const classified = new Set(ALL_BASE) // sem documento do imovel
    const attached = new Set(ALL_BASE)
    const d = deriveProcessState(
      facts({
        classifiedTypes: ready(classified),
        attachedTypes: attached,
        termoCompradores: absent<Person[]>(),
      }),
    )
    expect(d.ownerType.origin).toBe('undetermined')
    const keys = d.requiredDocs.flatMap((r) => r.keys)
    expect(keys).toContain(DOC.termoEntrega)
    expect(keys).toContain(DOC.termoQuitacao)
    expect(d.status).toBe('EM_DOCUMENTACAO') // nao PRONTA
  })
})

describe('deriveProcessState — co-comprador (Josemara: nao vira conjuge)', () => {
  test('2 compradores no termo -> exige RG do co-comprador; co-comprador nao e cônjuge', () => {
    const classified = new Set([...ALL_BASE, DOC.termoEntrega])
    const attached = new Set([...ALL_BASE, DOC.termoEntrega])
    const d = deriveProcessState(
      facts({
        classifiedTypes: ready(classified),
        attachedTypes: attached,
        termoCompradores: ready([titularA, buyerB]), // titular + co-comprador
      }),
    )
    expect(d.ownerType.value).toBe('titular_contrato_caixa')
    const keys = d.requiredDocs.flatMap((r) => r.keys)
    expect(keys).toContain(DOC.rgCoComprador)
    // RG do co-comprador nao anexado -> pendente
    expect(d.status).toBe('EM_DOCUMENTACAO')
  })
})
