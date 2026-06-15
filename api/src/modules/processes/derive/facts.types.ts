import type { ConjuntoMatchResult } from '../processes.procuracao-conjunto.compare'
import type { ProcessStatus } from '../processes.status'

// ── Fato com CICLO DE VIDA (dataflow input-complete) ──────────────────────────
// Um fato nao e so um valor: ele tem estado. 'pending' = um job que poderia
// produzi-lo esta em voo (NAO usavel). 'ready' = produzido. 'absent' = sabemos
// POSITIVAMENTE que nao existe (terminal, usavel). 'failed' = job falhou em
// definitivo (usavel, degradado -> revisao). E o que separa "ainda nao" de "nao
// existe" e impede decisao no timing errado.
export type FactState = 'pending' | 'ready' | 'absent' | 'failed'

export type Fact<T> = {
  state: FactState
  value?: T
}

// Dados pessoais extraidos de um documento oficial ou de uma parte de contrato.
export type Person = {
  nome: string
  cpf: string
  rg?: string
  nascimento?: string
}

export type CompraVenda = {
  vendedores: Person[]
  compradores: Person[]
  dataAssinatura?: string // ISO yyyy-mm-dd
}

// ── Os FATOS de um processo (snapshot) ────────────────────────────────────────
// Projetados de audits/colunas/checklist por gatherFacts (impuro). deriveProcessState
// (puro) consome SO isto.
export type ProcessFacts = {
  // Tipos de documento PRESENTES (classificados pela IA). 'pending' enquanto a
  // ingestao classifica; 'ready' com a classificacao concluida; 'absent' sem lote.
  classifiedTypes: Fact<Set<string>>
  // Tipos de documento com ARQUIVO corrente anexado (completude).
  attachedTypes: Set<string>
  // Algum item marcado OK_SEM_ARQUIVO (conta como "tem documento individual").
  hasOkWithoutFile: boolean

  // Identidade — QUEM (procuracao, ancora) e VALOR (documento oficial).
  outorgantes: Fact<Person[]>
  titularProcesso: Fact<Person[]> // dados oficiais do(s) titular(es) (RG/CNH)
  termoCompradores: Fact<Person[]> // [0]=titular_contrato_caixa, [1]=co-comprador
  compraVenda: Fact<CompraVenda>

  // Pre-requisito de DOCUMENTACAO_PRONTA (job procuracao->conjunto).
  housingComplexLinked: boolean
  // Conjunto habitacional sugerido pelo endereco da procuracao (match
  // deterministico, ja gated por outorgante==titular em gatherFacts). O auto-apply
  // e decidido no reconcile (flag + human-lock). 'absent' sem procuracao/endereco.
  conjuntoMatch: Fact<ConjuntoMatchResult>

  // Status atual (sempre conhecido — nao e um fato com ciclo de vida).
  currentStatus: ProcessStatus
}

export type OwnerType =
  | 'titular_contrato_caixa'
  | 'nao_titular_contrato_caixa'
  | '' // indeterminado/sem conclusao

// Exigencia satisfeita se QUALQUER das `keys` estiver anexada (OR-grupo) — ex.: o
// requiredDoc com >=1 key (OR). Hoje todos sao doc unico (keys de 1).
export type RequiredDoc = {
  keys: string[]
  becauseOf: string // proveniencia: por que e exigido (rastreabilidade)
}

// ── Saida da derivacao (tudo coerente, do MESMO conjunto de fatos) ────────────
export type Derived = {
  readiness: 'ready' | 'pending'
  pendingOn?: string // para a UI: "classificando", "lendo termo", ...
  ownerType: {
    value: OwnerType
    origin: 'human' | 'derived' | 'undetermined' | 'review'
    reason: string
  }
  // titular(es) do CONTRATO CAIXA = sujeitos da consulta de quitacao (RPA). 1-2
  // pessoas (titular + conjuge/co-comprador). O worker consulta cada CPF ate o
  // primeiro que emitir o termo de quitacao. [] quando indeterminado.
  quitacaoSubjects: Person[]
  requiredDocs: RequiredDoc[]
  status: ProcessStatus
  // Pendencias/validacoes que o usuario precisa resolver (bloqueiam PRONTA).
  reviewFlags: string[]
}
