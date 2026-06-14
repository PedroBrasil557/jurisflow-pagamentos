import { eq } from 'drizzle-orm'
import { db } from '../../../shared/db'
import { recordAiAnalysis } from '../../ai-analysis/ai-analysis.service'
import { process } from '../processes.schema'
import { deriveProcessState } from './derive'
import { gatherFacts } from './facts.gather'
import type { Derived, Fact, Person, ProcessFacts } from './facts.types'

export const PROCESS_DERIVATION_VERSION = 'process_derivation@1'

export type Divergence = {
  processId: string
  ownerCurrent: string
  ownerDerived: string
  ownerDiverged: boolean
  statusCurrent: string
  statusDerived: string
  statusDiverged: boolean
  readiness: string
  reviewFlags: string[]
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

// SHADOW: deriva + grava SO a evidencia process_derivation (snapshot + decisao +
// divergencia). NAO altera ownerType/status (isso e o flip, Fase 5). Best-effort.
export async function reconcileProcessShadow(processId: string): Promise<void> {
  try {
    const r = await shadowDerive(processId)
    if (!r) return
    await recordAiAnalysis({
      kind: 'process_derivation',
      processId,
      model: 'derive',
      promptVersion: PROCESS_DERIVATION_VERSION,
      input: { facts: factsSnapshot(r.facts) },
      decision: {
        ownerType: r.derived.ownerType,
        quitacaoSubject: r.derived.quitacaoSubject,
        status: r.derived.status,
        readiness: r.derived.readiness,
        reviewFlags: r.derived.reviewFlags,
        requiredDocs: r.derived.requiredDocs,
      },
      output: { divergence: r.divergence },
      status: 'ok',
      triggerSource: 'system',
    })
  } catch (error) {
    console.error('shadow: falha ao reconciliar (process_derivation)', {
      processId,
      error: String(error),
    })
  }
}
