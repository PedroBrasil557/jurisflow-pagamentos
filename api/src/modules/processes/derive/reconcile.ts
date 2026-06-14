import { eq } from 'drizzle-orm'
import { db } from '../../../shared/db'
import {
  type RecordAiAnalysisInput,
  recordAiAnalysis,
} from '../../ai-analysis/ai-analysis.service'
import { getCaixaOwnerAutoApply } from '../../settings/settings.service'
import { createProcessHistoryEntry } from '../processes.history.service'
import { process } from '../processes.schema'
import { deriveProcessState } from './derive'
import { gatherFacts } from './facts.gather'
import type { Derived, Fact, Person, ProcessFacts } from './facts.types'

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
      quitacaoSubject: r.derived.quitacaoSubject,
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

    // Status: motor existente (fiel) — le o ownerType atualizado para a ativacao
    // condicional. Import dinamico para evitar ciclo com checklist.service.
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
