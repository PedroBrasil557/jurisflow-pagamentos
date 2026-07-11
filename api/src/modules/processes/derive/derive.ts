import {
  type CaixaBuyer,
  compareCaixaOwner,
} from '../processes.caixa-owner.compare'
import type { ProcessStatus } from '../processes.status'
import type {
  Derived,
  OwnerType,
  Person,
  ProcessFacts,
  ReviewFlag,
} from './facts.types'

// ── Tipos de documento (fonte da verdade das regras) ──────────────────────────
export const DOC = {
  procuracao: 'procuracao_advogado',
  rgTitular: 'rg_cpf_cnh',
  rgCoComprador: 'rg_cpf_cnh_conjuge', // historicamente "conjuge"; semantica = co-comprador
  declaracao: 'declaracao_hipossuficiencia',
  honorarios: 'contrato_honorarios_advocaticios',
  termoEntrega: 'termo_entrega_recebimento_imovel',
  compraVenda: 'contrato_compra_venda',
} as const

// Base SEMPRE exigida (Passo 1 — gate fixo, nao depende de ownerType).
const BASE_DOCS = [
  DOC.procuracao,
  DOC.rgTitular,
  DOC.declaracao,
  DOC.honorarios,
] as const

// Vinculo do imovel com a Caixa: o termo de entrega/recebimento.
const VINCULO_IMOVEL = [DOC.termoEntrega]

// Regra legal: a compra e venda particular deve ser assinada APOS esta data.
export const COMPRA_VENDA_DATA_MINIMA = '2023-09-26'

// ── Readiness: o primitivo unico (input-complete) ─────────────────────────────
// Curto-circuita a derivacao quando um fato exigido ainda esta 'pending' (job em
// voo). 'ready'/'absent'/'failed' sao terminais — a regra os trata.
class Pending {
  constructor(readonly on: string) {}
}

function req<T>(fact: { state: string; value?: T }, label: string): T {
  if (fact.state === 'pending') {
    throw new Pending(label)
  }
  return fact.value as T
}

// ── deriveStatus: LIFT FIEL de reconcileProcessStatus ─────────────────────────
// Mantem exatamente as regras testadas (syncable guard, two-step, pre-requisito
// de completude). `documentationComplete` substitui (requiredPending===0 &&
// housingComplexLinked) — o caller estende com readiness/reviewFlags no v3.
const SYNCABLE: ProcessStatus[] = [
  'RASCUNHO',
  'CADASTRADO',
  'EM_LOTE',
  'EM_DOCUMENTACAO',
  'DOCUMENTACAO_PRONTA',
]

export function deriveStatus(input: {
  currentStatus: ProcessStatus
  hasIndividualDocs: boolean
  documentationComplete: boolean
}): ProcessStatus {
  const { currentStatus, hasIndividualDocs, documentationComplete } = input

  // Terminais e fase juridica nao sao tocados pela reconciliacao.
  if (!SYNCABLE.includes(currentStatus)) {
    return currentStatus
  }

  let target: ProcessStatus = hasIndividualDocs
    ? 'EM_DOCUMENTACAO'
    : 'CADASTRADO'

  // Avanco para PRONTA so a partir de EM_DOCUMENTACAO (predecessor legal — evita
  // salto ilegal CADASTRADO->PRONTA). Two-step preservado via fixpoint do caller.
  if (currentStatus === 'EM_DOCUMENTACAO' && documentationComplete) {
    target = 'DOCUMENTACAO_PRONTA'
  }
  // Mantem PRONTA quando ja PRONTA e completo.
  if (currentStatus === 'DOCUMENTACAO_PRONTA' && documentationComplete) {
    target = 'DOCUMENTACAO_PRONTA'
  }
  // Reverte PRONTA -> EM_DOCUMENTACAO se voltou a ficar incompleto.
  if (currentStatus === 'DOCUMENTACAO_PRONTA' && !documentationComplete) {
    target = 'EM_DOCUMENTACAO'
  }

  return target
}

// ── Helpers de identidade ─────────────────────────────────────────────────────
function toBuyer(p: Person): CaixaBuyer {
  return { nome: p.nome, cpf: p.cpf }
}

function has(facts: ProcessFacts, key: string): boolean {
  const classified = req(facts.classifiedTypes, 'classificando')
  return classified?.has(key) ?? false
}

// ── deriveOwner: ownerType (rotulo) + titular do contrato Caixa (quitacao) ─────
// Evidencia primeiro; a confirmacao humana (fato ownerTypeHuman, human-lock)
// resolve SO a inconclusao ('review'/'undetermined') — evidencia 'derived' segue
// vencendo no output (requiredDocs continuam dirigidos por evidencia). Pending
// continua propagando: o humano nao bypassa o input-complete.
function deriveOwner(facts: ProcessFacts): {
  ownerType: Derived['ownerType']
  quitacaoSubjects: Person[]
} {
  const evidence = deriveOwnerFromEvidence(facts)
  if (evidence.ownerType.origin === 'derived' || facts.ownerTypeHuman === '') {
    return evidence
  }
  return {
    ownerType: {
      value: facts.ownerTypeHuman,
      origin: 'human',
      reason: 'tipo de proprietario confirmado manualmente',
    },
    quitacaoSubjects: humanQuitacaoSubjects(facts),
  }
}

// Titulares do contrato Caixa segundo a escolha humana (R1/R2 do dominio):
// titular -> o proprio titular do processo; nao_titular -> melhor evidencia
// disponivel (vendedores do compra e venda, senao compradores do termo).
function humanQuitacaoSubjects(facts: ProcessFacts): Person[] {
  if (facts.ownerTypeHuman === 'titular_contrato_caixa') {
    return facts.titularProcesso.state === 'ready'
      ? (facts.titularProcesso.value ?? [])
      : []
  }
  if (facts.compraVenda.state === 'ready') {
    return facts.compraVenda.value?.vendedores ?? []
  }
  if (facts.termoCompradores.state === 'ready') {
    return facts.termoCompradores.value ?? []
  }
  return []
}

// REUSA compareCaixaOwner (titular x compradores -> titular/nao_titular/review).
// O titular comparado e o do processo (ancorado pela procuracao, valor do doc
// oficial). NAO le requiredDocs — e irmao dele, nao pai.
function deriveOwnerFromEvidence(facts: ProcessFacts): {
  ownerType: Derived['ownerType']
  quitacaoSubjects: Person[]
} {
  const titulares = req(facts.titularProcesso, 'titular') ?? []
  const titular = titulares[0]

  // Sem identidade do titular ainda -> nao da pra concluir.
  if (!titular) {
    return {
      ownerType: {
        value: '',
        origin: 'undetermined',
        reason: 'sem dados do titular',
      },
      quitacaoSubjects: [],
    }
  }

  const hasCompraVenda = has(facts, DOC.compraVenda)
  const hasTermo = has(facts, DOC.termoEntrega)

  // Ramo compra e venda: a CLASSIFICACAO ja basta para concluir nao_titular —
  // nao espera a extracao das partes (NAO faz req()). Os quitacaoSubjects (os
  // vendedores = titulares do contrato Caixa) dependem da extracao; ficam [] ate
  // estar 'ready'. Pode haver 1-2 vendedores -> consulta cada um.
  if (hasCompraVenda) {
    const cv =
      facts.compraVenda.state === 'ready' ? facts.compraVenda.value : undefined
    return {
      ownerType: {
        value: 'nao_titular_contrato_caixa',
        origin: 'derived',
        reason: 'contrato de compra e venda particular',
      },
      quitacaoSubjects: cv?.vendedores ?? [],
    }
  }

  // Ramo termo: match do titular contra os compradores do termo. Em AMBOS os
  // desfechos (titular/nao_titular) os titulares do contrato Caixa sao os
  // COMPRADORES DO TERMO (1-2: titular + conjuge/co-comprador) — consulta cada um.
  if (hasTermo) {
    const compradores = req(facts.termoCompradores, 'lendo termo') ?? []
    const r = compareCaixaOwner(compradores.map(toBuyer), {
      fullName: titular.nome,
      cpf: titular.cpf,
    })
    if (r.result === 'titular') {
      return {
        ownerType: {
          value: 'titular_contrato_caixa',
          origin: 'derived',
          reason: `titular consta no termo (match por ${r.matchedBy})`,
        },
        quitacaoSubjects: compradores,
      }
    }
    if (r.result === 'nao_titular') {
      return {
        ownerType: {
          value: 'nao_titular_contrato_caixa',
          origin: 'derived',
          reason: 'titular nao consta como comprador no termo',
        },
        quitacaoSubjects: compradores,
      }
    }
    // review: nao da pra afirmar igual nem diferente.
    return {
      ownerType: {
        value: '',
        origin: 'review',
        reason: 'nao foi possivel confirmar se o titular consta no termo',
      },
      quitacaoSubjects: [],
    }
  }

  // Sem termo e sem compra e venda: evidencia insuficiente.
  return {
    ownerType: {
      value: '',
      origin: 'undetermined',
      reason: 'sem documento do imovel (termo ou compra e venda)',
    },
    quitacaoSubjects: [],
  }
}

// ── deriveRequiredDocs: dirigido por EVIDENCIA (nao por ownerType) ────────────
function deriveRequiredDocs(
  facts: ProcessFacts,
  ownerValue: OwnerType,
): Derived['requiredDocs'] {
  const reqs: Derived['requiredDocs'] = BASE_DOCS.map((key) => ({
    keys: [key],
    becauseOf: 'documento base obrigatorio',
  }))

  // Vinculo do imovel com a Caixa: termo de entrega/recebimento.
  reqs.push({
    keys: VINCULO_IMOVEL,
    becauseOf: 'comprovacao do imovel (termo de entrega/recebimento)',
  })

  // Nao-titular (por match no termo OU por haver compra e venda) -> exige o
  // contrato de compra e venda. Olha a EVIDENCIA via ownerValue derivado em
  // paralelo (mesmo conjunto de fatos), nunca um estado persistido.
  if (ownerValue === 'nao_titular_contrato_caixa') {
    reqs.push({
      keys: [DOC.compraVenda],
      becauseOf: 'titular nao e o titular do contrato Caixa',
    })
  }

  // Co-comprador presente no termo -> exige o documento de identidade dele.
  if (facts.termoCompradores.state === 'ready') {
    const compradores = facts.termoCompradores.value ?? []
    if (compradores.length >= 2) {
      reqs.push({
        keys: [DOC.rgCoComprador],
        becauseOf: 'ha co-comprador no termo',
      })
    }
  }

  return reqs
}

// Data ISO yyyy-mm-dd -> dd/mm/yyyy (para exibicao). Best-effort.
function formatDateBr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

// ── Validacoes -> reviewFlags (bloqueiam avanco para PRONTA) ──────────────────
function deriveReviewFlags(
  facts: ProcessFacts,
  owner: Derived['ownerType'],
): ReviewFlag[] {
  const flags: ReviewFlag[] = []

  // Data de assinatura da compra e venda: deve ser POSTERIOR a data minima.
  if (facts.compraVenda.state === 'ready') {
    const data = facts.compraVenda.value?.dataAssinatura
    if (data && data <= COMPRA_VENDA_DATA_MINIMA) {
      flags.push({
        code: 'compra_venda_fora_do_prazo',
        titulo: 'Contrato de compra e venda fora do prazo legal',
        detalhe: `Assinado em ${formatDateBr(data)} — precisa ser posterior a ${formatDateBr(
          COMPRA_VENDA_DATA_MINIMA,
        )} (Portaria MCID nº 1.248/2023).`,
        docKey: DOC.compraVenda,
      })
    }
  }

  // Indeterminado/revisao -> sinaliza para o humano (e orienta a saida: a
  // confirmacao manual do ownerType e o que resolve a pendencia).
  if (owner.origin === 'review') {
    const motivo =
      owner.reason ||
      'Não foi possível confirmar se o titular consta no termo da Caixa'
    flags.push({
      code: 'owner_type_ambiguo',
      titulo: 'Tipo de proprietário ambíguo',
      detalhe: `${motivo} — edite o processo e informe o tipo de proprietário para confirmar manualmente.`,
    })
  }

  return flags
}

// ── deriveProcessState: compoe tudo, input-complete ───────────────────────────
export function deriveProcessState(facts: ProcessFacts): Derived {
  try {
    const { ownerType, quitacaoSubjects } = deriveOwner(facts)
    const requiredDocs = deriveRequiredDocs(facts, ownerType.value)
    const reviewFlags = deriveReviewFlags(facts, ownerType)

    // Pendencia da base (Passo 1) + demais exigencias: faltam keys sem anexo.
    const missing = requiredDocs.filter(
      (rd) => !rd.keys.some((k) => facts.attachedTypes.has(k)),
    )
    const requiredPending = missing.length

    const hasIndividualDocs =
      facts.attachedTypes.size > 0 || facts.hasOkWithoutFile

    // Documentacao completa (gate de PRONTA): tudo anexado + conjunto vinculado
    // + sem pendencia de revisao bloqueante.
    const documentationComplete =
      requiredPending === 0 &&
      facts.housingComplexLinked &&
      reviewFlags.length === 0

    const status = deriveStatus({
      currentStatus: facts.currentStatus,
      hasIndividualDocs,
      documentationComplete,
    })

    return {
      readiness: 'ready',
      ownerType,
      quitacaoSubjects,
      requiredDocs,
      status,
      reviewFlags,
    }
  } catch (e) {
    if (e instanceof Pending) {
      // Algum job exigido esta em voo -> NAO decide. Nunca AVANCA para PRONTA com
      // fato pendente; mas tambem nao REVERTE PRONTA por causa de um job transitorio
      // (anti-flapping): um PRONTA so cai quando a documentacao fica genuinamente
      // incompleta (fato 'ready'/'absent', nao 'pending'). O reconciliador e
      // level-triggered: re-dispara quando o fato assenta e decide corretamente.
      const hasIndividualDocs =
        facts.attachedTypes.size > 0 || facts.hasOkWithoutFile
      const status =
        facts.currentStatus === 'DOCUMENTACAO_PRONTA'
          ? 'DOCUMENTACAO_PRONTA'
          : deriveStatus({
              currentStatus: facts.currentStatus,
              hasIndividualDocs,
              documentationComplete: false,
            })
      return {
        readiness: 'pending',
        pendingOn: e.on,
        ownerType: { value: '', origin: 'undetermined', reason: e.on },
        quitacaoSubjects: [],
        requiredDocs: [],
        status,
        reviewFlags: [],
      }
    }
    throw e
  }
}
