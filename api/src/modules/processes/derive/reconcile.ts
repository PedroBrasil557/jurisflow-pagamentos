import { eq } from 'drizzle-orm'
import { db } from '../../../shared/db'
import { isValidCpf, normalizeCpf } from '../../../shared/utils/cpf'
import {
  type RecordAiAnalysisInput,
  recordAiAnalysis,
} from '../../ai-analysis/ai-analysis.service'
import {
  aggregateQuitacaoStatus,
  type QuitacaoConsulta,
} from '../../caixa-quitacao/quitacao-consulta'
import {
  getCaixaOwnerAutoApply,
  getProcuracaoConjuntoAutoApply,
} from '../../settings/settings.service'
import { createProcessHistoryEntry } from '../processes.history.service'
import { decideProcuracaoConjuntoOutcome } from '../processes.procuracao-conjunto.compare'
import { process } from '../processes.schema'
import { deriveProcessState } from './derive'
import { gatherFacts } from './facts.gather'
import type {
  Derived,
  Fact,
  Person,
  ProcessFacts,
  ReviewFlag,
} from './facts.types'

export const PROCESS_DERIVATION_VERSION = 'process_derivation@1'
// Ator das acoes automaticas (usuario tecnico seedado na migracao).
const SYSTEM_ACTOR_ID = 'jurisflow-bot'

export type Divergence = {
  processId: string
  ownerCurrent: string
  ownerDerived: string
  ownerDiverged: boolean
  statusCurrent: string
  statusDerived: string
  statusDiverged: boolean
  readiness: string
  reviewFlags: ReviewFlag[]
}

const persons = (f: Fact<Person[]>) =>
  f.state === 'ready'
    ? (f.value ?? []).map((p) => ({ nome: p.nome, cpf: p.cpf }))
    : undefined

// Snapshot compacto dos fatos consumidos (rastreabilidade: "por que decidiu X").
function factsSnapshot(f: ProcessFacts) {
  return {
    classifiedTypes: {
      state: f.classifiedTypes.state,
      value: f.classifiedTypes.value ? [...f.classifiedTypes.value] : undefined,
    },
    attachedTypes: [...f.attachedTypes],
    titularProcesso: {
      state: f.titularProcesso.state,
      value: persons(f.titularProcesso),
    },
    termoCompradores: {
      state: f.termoCompradores.state,
      value: persons(f.termoCompradores),
    },
    compraVenda: {
      state: f.compraVenda.state,
      vendedores:
        f.compraVenda.state === 'ready'
          ? (f.compraVenda.value?.vendedores ?? []).map((p) => ({
              nome: p.nome,
              cpf: p.cpf,
            }))
          : undefined,
      dataAssinatura:
        f.compraVenda.state === 'ready'
          ? f.compraVenda.value?.dataAssinatura
          : undefined,
    },
    outorgantes: { state: f.outorgantes.state, value: persons(f.outorgantes) },
    housingComplexLinked: f.housingComplexLinked,
    ownerTypeHuman: f.ownerTypeHuman,
    conjuntoMatch: {
      state: f.conjuntoMatch.state,
      result: f.conjuntoMatch.value?.result,
      conjunto: f.conjuntoMatch.value?.conjunto?.name,
      matchedBy: f.conjuntoMatch.value?.matchedBy,
    },
    currentStatus: f.currentStatus,
  }
}

function computeDivergence(
  processId: string,
  ownerCurrent: string,
  statusCurrent: string,
  d: Derived,
): Divergence {
  return {
    processId,
    ownerCurrent,
    ownerDerived: d.ownerType.value,
    // So conta como divergencia se a derivacao CONCLUI (origin=derived) e difere.
    ownerDiverged:
      d.ownerType.origin === 'derived' && d.ownerType.value !== ownerCurrent,
    statusCurrent,
    statusDerived: d.status,
    statusDiverged: d.status !== statusCurrent,
    readiness: d.readiness,
    reviewFlags: d.reviewFlags,
  }
}

// Deriva + compara com o estado atual. NAO escreve estado derivado. Read-only.
export async function shadowDerive(processId: string): Promise<{
  divergence: Divergence
  derived: Derived
  facts: ProcessFacts
} | null> {
  const facts = await gatherFacts(processId)
  if (!facts) return null
  const [proc] = await db
    .select({ ownerType: process.ownerType, status: process.status })
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)
  if (!proc) return null

  const derived = deriveProcessState(facts)
  const divergence = computeDivergence(
    processId,
    proc.ownerType,
    proc.status,
    derived,
  )
  return { divergence, derived, facts }
}

// Grava a evidencia append-only process_derivation (snapshot dos fatos + decisao
// + divergencia). triggeredByUserId opcional. Best-effort (chamador trata).
async function recordDerivationEvidence(
  processId: string,
  r: NonNullable<Awaited<ReturnType<typeof shadowDerive>>>,
  triggeredByUserId: string | null = null,
): Promise<void> {
  const input: RecordAiAnalysisInput = {
    kind: 'process_derivation',
    processId,
    model: 'derive',
    promptVersion: PROCESS_DERIVATION_VERSION,
    input: { facts: factsSnapshot(r.facts) },
    decision: {
      ownerType: r.derived.ownerType,
      quitacaoSubjects: r.derived.quitacaoSubjects,
      status: r.derived.status,
      readiness: r.derived.readiness,
      reviewFlags: r.derived.reviewFlags,
      requiredDocs: r.derived.requiredDocs,
    },
    output: { divergence: r.divergence },
    status: 'ok',
    triggerSource: triggeredByUserId ? 'user' : 'system',
    triggeredByUserId,
  }
  await recordAiAnalysis(input)
}

// SHADOW: deriva + grava SO a evidencia. NAO altera ownerType/status. Best-effort.
export async function reconcileProcessShadow(processId: string): Promise<void> {
  try {
    const r = await shadowDerive(processId)
    if (!r) return
    await recordDerivationEvidence(processId, r)
  } catch (error) {
    console.error('shadow: falha ao reconciliar (process_derivation)', {
      processId,
      error: String(error),
    })
  }
}

// Mapeia a derivacao para o estado operacional caixaAnalysisStatus (consumido
// pelo card "Tipo de proprietario").
function caixaStatusFor(d: Derived): 'idle' | 'done' | 'review' {
  if (d.readiness === 'pending') return 'idle'
  if (d.ownerType.origin === 'review') return 'review'
  if (d.ownerType.origin === 'undetermined') return 'idle'
  return 'done'
}

// FLIP (Fase 5): o reconciliador e o UNICO autor do ownerType, via derive (gated
// por autoApply, reversivel). Grava evidencia, aplica ownerType quando conclui com
// confianca e sem human-lock, e delega o status ao motor existente (fiel, que le
// o ownerType atualizado para a ativacao condicional). Best-effort: nunca lanca.
export async function reconcileOwnerType(input: {
  processId: string
  triggeredByUserId?: string | null
}): Promise<void> {
  const { processId } = input
  try {
    const r = await shadowDerive(processId)
    if (!r) return
    await recordDerivationEvidence(
      processId,
      r,
      input.triggeredByUserId ?? null,
    )

    const autoApply = await getCaixaOwnerAutoApply()
    const [proc] = await db
      .select({
        ownerType: process.ownerType,
        ownerTypeSource: process.ownerTypeSource,
        housingComplex: process.housingComplex,
        housingComplexSource: process.housingComplexSource,
        procuracaoConjuntoStatus: process.procuracaoConjuntoStatus,
      })
      .from(process)
      .where(eq(process.id, processId))
      .limit(1)
    if (!proc) return

    const d = r.derived
    const humanLocked =
      proc.ownerTypeSource === 'human' && proc.ownerType !== ''
    const shouldApply =
      autoApply &&
      d.ownerType.origin === 'derived' &&
      d.ownerType.value !== proc.ownerType &&
      !humanLocked

    if (shouldApply) {
      await db
        .update(process)
        .set({
          ownerType: d.ownerType.value,
          ownerTypeSource: 'system',
          caixaAnalysisStatus: 'done',
        })
        .where(eq(process.id, processId))
      await createProcessHistoryEntry({
        processId,
        actorUserId: SYSTEM_ACTOR_ID,
        eventType: 'CAIXA_OWNER_AUTO_SET',
        notes: `Tipo de proprietario definido: ${d.ownerType.value} (${d.ownerType.reason}).`,
        metadata: {
          fromOwnerType: proc.ownerType,
          toOwnerType: d.ownerType.value,
        },
      })
    } else {
      await db
        .update(process)
        .set({ caixaAnalysisStatus: caixaStatusFor(d) })
        .where(eq(process.id, processId))
    }

    // ── Conjunto habitacional (absorve a antiga analise procuracao-conjunto) ──
    // Decide/aplica a partir do fato conjuntoMatch (match puro feito em gatherFacts),
    // gated por flag + human-lock. ANTES do reconcileProcessStatus: vincular o
    // conjunto muda os docs de escopo de conjunto (herdados) e e pre-requisito de PRONTA.
    await applyConjuntoMatch(processId, r.facts.conjuntoMatch, {
      housingComplex: proc.housingComplex,
      housingComplexSource: proc.housingComplexSource,
      procuracaoConjuntoStatus: proc.procuracaoConjuntoStatus,
    })

    // ── Quitacao: reconcilia o ESTADO DE CONSULTA por CPF contra os titulares do
    // contrato Caixa derivados (set-diff: adiciona CPF novo como 'pending', remove o
    // que saiu, PRESERVA o terminal de quem continua). Separa identidade (quem) de
    // workflow (consulta por CPF). NUNCA usa process.cpf.
    await reconcileQuitacaoConsultas(processId, d.quitacaoSubjects)

    // Status: motor existente (fiel) — le o ownerType/conjunto atualizados para a
    // ativacao condicional. Import dinamico para evitar ciclo com checklist.service.
    const { reconcileProcessStatus } = await import(
      '../processes.checklist.service'
    )
    await reconcileProcessStatus(processId, {
      id: SYSTEM_ACTOR_ID,
    } as Parameters<typeof reconcileProcessStatus>[1])
  } catch (error) {
    console.error('reconcileOwnerType: falha', {
      processId,
      error: String(error),
    })
  }
}

// Reconcilia o ESTADO DE CONSULTA (por CPF) contra os titulares do contrato Caixa
// derivados. SET-DIFF declarativo: CPF novo -> entrada 'pending'; CPF removido ->
// dropa; CPF que continua -> PRESERVA (nunca re-consulta um terminal so porque o
// conjunto mudou). Sem comparacao de string/ordem — compara o CONJUNTO de CPFs.
// Best-effort.
async function reconcileQuitacaoConsultas(
  processId: string,
  subjects: Person[],
): Promise<void> {
  // Identidade: CPFs desejados (normalizados, validos, sem duplicata).
  const desired: string[] = []
  for (const s of subjects) {
    const c = s.cpf ? normalizeCpf(s.cpf) : ''
    if (c && isValidCpf(c) && !desired.includes(c)) {
      desired.push(c)
    }
  }

  const [proc] = await db
    .select({
      consultas: process.quitacaoConsultas,
      status: process.caixaQuitacaoStatus,
    })
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)
  if (!proc) return

  const current = proc.consultas ?? []
  const currentCpfs = new Set(current.map((c) => c.cpf))

  // Identidade inalterada (mesmo CONJUNTO de CPFs) -> no-op: preserva todos os
  // estados (inclusive terminais). Resolve a re-consulta por ordem/tamanho.
  if (
    currentCpfs.size === desired.length &&
    desired.every((c) => currentCpfs.has(c))
  ) {
    return
  }

  // Mudou: preserva entrada existente de cada CPF que CONTINUA; novo -> 'pending';
  // removido -> sai (nao entra em `next`).
  const byCpf = new Map(current.map((c) => [c.cpf, c]))
  const next: QuitacaoConsulta[] = desired.map(
    (cpf) => byCpf.get(cpf) ?? { cpf, status: 'pending' as const },
  )

  const aggregate = aggregateQuitacaoStatus(next)
  // Reabriu para consulta (ha CPF novo pendente) e nao estava em voo -> zera o
  // backoff (attempts) para o worker reivindicar ja.
  const reopened =
    aggregate === 'pending' &&
    proc.status !== 'pending' &&
    proc.status !== 'processing'

  await db
    .update(process)
    .set({
      quitacaoConsultas: next,
      caixaQuitacaoStatus: aggregate,
      ...(reopened ? { caixaQuitacaoAttempts: 0 } : {}),
    })
    .where(eq(process.id, processId))
}

// Aplica o conjunto habitacional sugerido pelo endereco da procuracao (fato
// conjuntoMatch). PURA exceto o write: reusa decideProcuracaoConjuntoOutcome (flag +
// human-lock). So escreve a coluna procuracaoConjuntoStatus quando ha um match
// CONCLUIDO ('ready'); pending/absent nao mexem (card fica 'idle'). Best-effort.
async function applyConjuntoMatch(
  processId: string,
  conjuntoMatch: ProcessFacts['conjuntoMatch'],
  proc: {
    housingComplex: string
    housingComplexSource: string
    procuracaoConjuntoStatus: string
  },
): Promise<void> {
  if (conjuntoMatch.state !== 'ready' || !conjuntoMatch.value) {
    return
  }
  const autoApply = await getProcuracaoConjuntoAutoApply()
  const outcome = decideProcuracaoConjuntoOutcome({
    matchResult: conjuntoMatch.value,
    currentHousingComplex: proc.housingComplex,
    housingComplexSource: proc.housingComplexSource,
    autoApplyEnabled: autoApply,
  })

  await db.transaction(async (tx) => {
    if (outcome.apply && outcome.newHousingComplex) {
      await tx
        .update(process)
        .set({
          housingComplex: outcome.newHousingComplex,
          housingComplexId: conjuntoMatch.value?.conjunto?.id ?? null,
          housingComplexSource: 'system',
          procuracaoConjuntoStatus: outcome.analysisStatus,
        })
        .where(eq(process.id, processId))
    } else {
      await tx
        .update(process)
        .set({ procuracaoConjuntoStatus: outcome.analysisStatus })
        .where(eq(process.id, processId))
    }

    // Historico so em TRANSICAO de estado (review->review a cada reconcile
    // spamava PROCURACAO_CONJUNTO_REVIEW_REQUIRED). A divergencia continua
    // visivel pelo card via `decision` da analise, nao pelo historico.
    if (
      outcome.historyEvent &&
      outcome.analysisStatus !== proc.procuracaoConjuntoStatus
    ) {
      await createProcessHistoryEntry({
        processId,
        actorUserId: SYSTEM_ACTOR_ID,
        eventType: outcome.historyEvent,
        notes: outcome.apply
          ? 'Conjunto preenchido automaticamente a partir da procuracao.'
          : outcome.divergence
            ? 'A procuracao indica um conjunto diferente do informado — conferir.'
            : 'A analise da procuracao precisa de revisao humana.',
        metadata: {
          fromHousingComplex: proc.housingComplex,
          toHousingComplex: outcome.newHousingComplex ?? proc.housingComplex,
          matchedBy: conjuntoMatch.value?.matchedBy,
        },
        executor: tx,
      })
    }
  })
}
