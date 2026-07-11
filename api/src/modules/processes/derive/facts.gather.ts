import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../shared/db'
import { normalizeName } from '../../../shared/utils/name'
import { aiAnalysis } from '../../ai-analysis/ai-analysis.schema'
import { housingComplex } from '../../housing-complexes/housing-complexes.schema'
import {
  type ConjuntoMatchResult,
  matchConjuntoInAddress,
} from '../processes.procuracao-conjunto.compare'
import {
  process,
  processBatchFile,
  processDocument,
  processDocumentFile,
  processDocumentType,
} from '../processes.schema'
import { DOC } from './derive'
import type {
  CompraVenda,
  Fact,
  OwnerType,
  Person,
  ProcessFacts,
} from './facts.types'

// gatherFacts: UNICO ponto que LE o mundo. Projeta colunas/audits/checklist nos
// fatos com ciclo de vida. Impuro; deriveProcessState (puro) consome a saida.

const ready = <T>(value: T): Fact<T> => ({ state: 'ready', value })
const absent = <T>(): Fact<T> => ({ state: 'absent' })
const pending = <T>(): Fact<T> => ({ state: 'pending' })

type RawP = { nome?: string; cpf?: string; rg?: string; nascimento?: string }
type DocOutput = {
  paginas?: Array<{ pagina: number; tipo: string }>
  outorgantes?: RawP[]
  compraVenda?: {
    vendedores?: RawP[]
    compradores?: RawP[]
    dataAssinatura?: string
  }
  termoCompradores?: RawP[]
  procuracaoEndereco?: string
  procuracaoCidade?: string
}
type Decision = {
  attached?: Array<{ documentTypeKey: string }>
  skipped?: Array<{ documentTypeKey: string }>
}

function toPerson(r: RawP | undefined): Person | null {
  const cpf = r?.cpf?.trim()
  if (!cpf) return null
  return {
    nome: r?.nome ?? '',
    cpf,
    rg: r?.rg || undefined,
    nascimento: r?.nascimento || undefined,
  }
}
const toPersons = (rs: RawP[] | undefined): Person[] =>
  (rs ?? []).map(toPerson).filter((p): p is Person => p !== null)

// Guarda contra valor legado na coluna text (ex.: conjuge_titular_contrato_caixa,
// removido na migracao 0025): so os valores vigentes contam como confirmacao.
const isKnownOwnerType = (v: string): v is Exclude<OwnerType, ''> =>
  v === 'titular_contrato_caixa' || v === 'nao_titular_contrato_caixa'

// Junta os termoCompradores espalhados em audits diferentes (o termo_entrega tem o
// CPF; a declaracao de quitacao pode so ter o nome). Dedup por nome NORMALIZADO
// (normalizeName: sem acento/caixa/espaco — MESMA regra do compareCaixaOwner, que
// decide o ownerType). Usar `.toUpperCase()` cru divergia: "José"/"JOSE" nao fundiam
// e inflavam a contagem de compradores (co-comprador fantasma -> exige RG inexistente).
// Eleva a versao com CPF quando o mesmo nome reaparece. PURA (testavel).
export function mergeTermoCompradores(outputs: DocOutput[]): RawP[] {
  const merged: RawP[] = []
  for (const out of outputs) {
    for (const t of out.termoCompradores ?? []) {
      if (!t.nome) continue
      const key = normalizeName(t.nome)
      const idx = merged.findIndex((x) => normalizeName(x.nome ?? '') === key)
      if (idx === -1) {
        merged.push(t)
      } else if (!merged[idx].cpf && t.cpf) {
        merged[idx] = t // upgrade: prioriza a versao com CPF
      }
    }
  }
  return merged
}
// Audit LEGADO kind caixa_owner (analise removida na v3): por doc, o titular do
// termo (1o comprador) e o conjuge (2o comprador). Lido so como FALLBACK para
// processos antigos cujo document_extraction ainda nao traz termoCompradores.
type CaixaByDoc = {
  byDoc?: Array<{
    titular?: string | null
    cpfTitular?: string | null
    conjuge?: string | null
    cpfConjuge?: string | null
  }>
}

export async function gatherFacts(
  processId: string,
): Promise<ProcessFacts | null> {
  const [proc] = await db
    .select({
      status: process.status,
      housingComplexId: process.housingComplexId,
      fullName: process.fullName,
      cpf: process.cpf,
      rg: process.rg,
      birthDate: process.birthDate,
      ownerType: process.ownerType,
      ownerTypeSource: process.ownerTypeSource,
    })
    .from(process)
    .where(eq(process.id, processId))
    .limit(1)

  if (!proc) {
    return null
  }

  const [batchFiles, docExtractions, caixaAudits, checklist, conjuntos] =
    await Promise.all([
      db
        .select({ splitStatus: processBatchFile.splitStatus })
        .from(processBatchFile)
        .where(eq(processBatchFile.processId, processId)),
      db
        .select({ output: aiAnalysis.output, decision: aiAnalysis.decision })
        .from(aiAnalysis)
        .where(
          and(
            eq(aiAnalysis.processId, processId),
            eq(aiAnalysis.kind, 'document_extraction'),
          ),
        )
        .orderBy(desc(aiAnalysis.createdAt)),
      db
        .select({ output: aiAnalysis.output })
        .from(aiAnalysis)
        .where(
          and(
            eq(aiAnalysis.processId, processId),
            eq(aiAnalysis.kind, 'caixa_owner'),
          ),
        )
        .orderBy(desc(aiAnalysis.createdAt))
        .limit(1),
      db
        .select({
          key: processDocumentType.key,
          docStatus: processDocument.status,
          fileId: processDocumentFile.id,
        })
        .from(processDocument)
        .innerJoin(
          processDocumentType,
          eq(processDocument.documentTypeId, processDocumentType.id),
        )
        .leftJoin(
          processDocumentFile,
          and(
            eq(processDocumentFile.processDocumentId, processDocument.id),
            eq(processDocumentFile.isCurrent, true),
          ),
        )
        .where(eq(processDocument.processId, processId)),
      // Conjuntos cadastrados — para casar o endereco da procuracao (match puro).
      db
        .select({
          id: housingComplex.id,
          name: housingComplex.name,
          city: housingComplex.city,
        })
        .from(housingComplex),
    ])

  // ── attachedTypes + hasOkWithoutFile ──
  const attachedTypes = new Set<string>()
  let hasOkWithoutFile = false
  for (const row of checklist) {
    if (row.fileId) {
      attachedTypes.add(row.key)
    }
    if (row.docStatus === 'OK_SEM_ARQUIVO') {
      hasOkWithoutFile = true
    }
  }

  // ── classifiedTypes (tipos que a IA reconheceu) + ciclo de vida ──
  const classifiedSet = new Set<string>(attachedTypes)
  for (const a of docExtractions) {
    const out = (a.output ?? {}) as DocOutput
    for (const p of out.paginas ?? []) {
      if (p.tipo && p.tipo !== 'nao_identificado') {
        classifiedSet.add(p.tipo)
      }
    }
    const dec = (a.decision ?? {}) as Decision
    for (const x of dec.attached ?? []) classifiedSet.add(x.documentTypeKey)
    for (const x of dec.skipped ?? []) classifiedSet.add(x.documentTypeKey)
  }
  // Classificacao sempre SABE o conjunto atual de tipos presentes (= anexados +
  // o que a IA reconheceu). So fica 'pending' quando um scan esta em voo (vamos
  // saber mais ja-ja). Nunca 'absent' — no minimo um conjunto vazio.
  const inFlightSplit = batchFiles.some((b) =>
    ['idle', 'queued', 'processing'].includes(b.splitStatus),
  )
  const classifiedTypes: Fact<Set<string>> = inFlightSplit
    ? pending()
    : ready(classifiedSet)

  // ── titularProcesso (valor do documento oficial, ja salvo na linha) ──
  const titularProcesso: Fact<Person[]> = proc.cpf?.trim()
    ? ready([
        {
          nome: proc.fullName,
          cpf: proc.cpf,
          rg: proc.rg || undefined,
          nascimento: proc.birthDate || undefined,
        },
      ])
    : absent()

  // ── compraVenda / outorgantes / termoCompradores / endereco: por papel ──
  // Le do audit document_extraction mais recente que contenha cada campo. NAO
  // bloqueia o ownerType (leitura suave).
  let rawCompraVenda: DocOutput['compraVenda']
  let rawOutorgantes: RawP[] | undefined
  let rawProcuracaoEndereco: string | undefined
  let rawProcuracaoCidade: string | undefined
  const docOutputs = docExtractions.map((a) => (a.output ?? {}) as DocOutput)
  for (const out of docOutputs) {
    if (!rawCompraVenda && out.compraVenda) rawCompraVenda = out.compraVenda
    if (!rawOutorgantes && out.outorgantes?.length) {
      rawOutorgantes = out.outorgantes
    }
    if (!rawProcuracaoEndereco && out.procuracaoEndereco) {
      rawProcuracaoEndereco = out.procuracaoEndereco
      rawProcuracaoCidade = out.procuracaoCidade
    }
  }
  // termoCompradores e UNIAO entre audits (helper puro: dedup por nome normalizado,
  // elevando a versao com CPF) — reproduz a antiga analise caixa-owner.
  const termoMerged = mergeTermoCompradores(docOutputs)
  const rawTermoCompradores = termoMerged.length ? termoMerged : undefined

  // ── termoCompradores ── FONTE PRIMARIA: document_extraction (v3, extracao por
  // papel). Fallback: audit caixa_owner legado (dupla fonte na transicao). Ciclo de
  // vida chaveado por inFlightSplit (NAO mais por caixaAnalysisStatus, que virou
  // estado de exibicao derivado). [0]=titular do termo, [1]=co-comprador.
  const termoClassified = classifiedSet.has(DOC.termoEntrega)
  const caixaOut = (caixaAudits[0]?.output ?? null) as CaixaByDoc | null
  let termoCompradores: Fact<Person[]>
  if (rawTermoCompradores?.length) {
    const compradores = toPersons(rawTermoCompradores)
    termoCompradores = compradores.length ? ready(compradores) : absent()
  } else if (caixaOut?.byDoc?.length) {
    const compradores: Person[] = []
    const seen = new Set<string>()
    for (const d of caixaOut.byDoc) {
      if (d.titular && d.cpfTitular && !seen.has(d.cpfTitular)) {
        seen.add(d.cpfTitular)
        compradores.push({ nome: d.titular, cpf: d.cpfTitular })
      }
      if (d.conjuge && d.cpfConjuge && !seen.has(d.cpfConjuge)) {
        seen.add(d.cpfConjuge)
        compradores.push({ nome: d.conjuge, cpf: d.cpfConjuge })
      }
    }
    termoCompradores = compradores.length ? ready(compradores) : absent()
  } else if (inFlightSplit) {
    termoCompradores = pending()
  } else {
    termoCompradores = termoClassified ? pending() : absent()
  }

  const compraVenda: Fact<CompraVenda> = rawCompraVenda
    ? ready({
        vendedores: toPersons(rawCompraVenda.vendedores),
        compradores: toPersons(rawCompraVenda.compradores),
        dataAssinatura: rawCompraVenda.dataAssinatura,
      })
    : classifiedSet.has(DOC.compraVenda)
      ? pending()
      : absent()

  const outorgantes: Fact<Person[]> = rawOutorgantes
    ? ready(toPersons(rawOutorgantes))
    : classifiedSet.has(DOC.procuracao)
      ? pending()
      : absent()

  // ── conjuntoMatch ── casa o endereco da procuracao com o cadastro (match PURO,
  // deterministico). O bundle e por-processo (a procuracao ali e DESTE cliente),
  // entao NAO ha gate de outorgante x titular — confia direto no endereco extraido
  // (evita falso-negativo por erro de OCR no CPF do outorgante). Auto-apply no reconcile.
  let conjuntoMatch: Fact<ConjuntoMatchResult>
  if (rawProcuracaoEndereco) {
    conjuntoMatch = ready(
      matchConjuntoInAddress(
        {
          addressText: rawProcuracaoEndereco,
          addressCity: rawProcuracaoCidade,
        },
        conjuntos,
      ),
    )
  } else if (classifiedSet.has(DOC.procuracao)) {
    conjuntoMatch = pending()
  } else {
    conjuntoMatch = absent()
  }

  // ── ownerTypeHuman (human-lock projetado como fato) ──
  const ownerTypeHuman: OwnerType =
    proc.ownerTypeSource === 'human' && isKnownOwnerType(proc.ownerType)
      ? proc.ownerType
      : ''

  return {
    classifiedTypes,
    attachedTypes,
    hasOkWithoutFile,
    outorgantes,
    titularProcesso,
    termoCompradores,
    compraVenda,
    housingComplexLinked: proc.housingComplexId !== null,
    conjuntoMatch,
    ownerTypeHuman,
    currentStatus: proc.status,
  }
}
