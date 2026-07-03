# Fluxo de ingestão de PDF — pipeline do processo

> Documento conferido contra o **código atual** (`api/src/...`, `worker/src/...`),
> não contra comentários. Mostra o caminho do PDF desde o upload até o processo ter
> `ownerType`, conjunto, quitação e status derivados — marcando **quando cada job/
> fila nasce**, o que é **síncrono** vs **assíncrono**, e o que é **durável**
> (sobrevive a crash) vs **frágil** (`void`).
>
> Diagramas em [Mermaid](https://mermaid.js.org) (renderizam no preview do VS Code
> com *Markdown Preview Mermaid Support*, e no GitHub).

## Legenda

| Símbolo | Significado |
|---|---|
| 🟢 **durável** | tem fila no banco + worker que re-tenta; sobrevive a crash/restart |
| 🔴 **frágil** | disparado `void` (fire-and-forget) na API; se falhar, **não há backstop** que re-dispare |
| ⏱️ **síncrono** | aguardado (`await`) dentro do fluxo de quem chama |
| 🔁 **assíncrono** | processo/loop separado, ou `void` |
| 📦 **fila** | estado durável no Postgres de onde um worker puxa trabalho |

---

## 1. Visão geral (quem fala com quem)

```mermaid
flowchart LR
    U([Usuário]) -->|1. upload PDF| API[API Hono]
    API -->|guarda arquivo| S3[(MinIO / storage)]
    API -->|insere linha splitStatus=queued| QI[["📦 Fila ingestão<br/>process_batch_file"]]
    API -.->|200 na hora| U

    QI <-->|claim 3s · SKIP LOCKED| WI[["🟢 Worker ingestão<br/>container ingestion-worker"]]
    WI -->|lê PDF| S3
    WI <-->|1 chamada: classifica + extrai por papel| IA[(Provedor IA)]
    WI -->|aplica campos + corta/anexa docs + auditoria| DB[(Banco · process)]
    WI -.->|pós-split done · void| RC{{reconcileOwnerType}}

    RC -->|gatherFacts + deriveProcessState puro| DB
    RC -->|cria a fila de quitação por CPF| QQ[["📦 Fila quitação<br/>quitacao_consultas (jsonb)"]]

    QQ <-->|claim 5s via /claim| WR[["🟢 Worker RPA<br/>container worker"]]
    WR <-->|consulta cada CPF| CX[(Portal Caixa)]
    WR -->|/result por CPF → anexa declaração| API
    API -.->|anexo dispara · void| RC
```

> **Não há mais** análises detached separadas de *caixa-owner* nem *procuração-
> conjunto*. Uma **única** extração de IA na ingestão já traz todos os papéis
> (titular, outorgantes, compradores do termo, compra-venda); o resto é **derivado**
> dos fatos. Anexos avulsos disparam a **mesma** extração (`reextractDocAndReconcile`).

---

## 2. Sequência detalhada — quando nasce cada job e fila

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant API as API (Hono)
    participant S3 as MinIO
    participant QI as 📦 Fila ingestão<br/>(process_batch_file)
    participant WI as 🟢 Worker ingestão
    participant IA as Provedor IA
    participant RC as reconcileOwnerType<br/>(derive)
    participant DB as Banco (process)
    participant QQ as 📦 Fila quitação<br/>(quitacao_consultas)
    participant WR as 🟢 Worker RPA
    participant CX as Portal Caixa

    rect rgb(232,245,233)
    Note over U,QI: ATO 1 — Upload (⏱️ síncrono, na request)
    U->>API: upload do PDF (scan ou import)
    API->>S3: guarda o arquivo
    API->>QI: INSERT process_batch_file (splitStatus='queued')
    Note right of QI: ⬅️ JOB DE INGESTÃO CRIADO
    API-->>U: 200 — não processa nada ainda
    end

    rect rgb(227,242,253)
    Note over WI,DB: ATO 2 — Worker ingestão. background, poll 3s, concorrencia 2
    loop drainClaims
        WI->>QI: claim queued ou processing orfao. vira processing + lease + token
    end
    Note right of QI: FOR UPDATE SKIP LOCKED, split_attempts + 1
    WI->>S3: le o PDF
    WI->>IA: 1 chamada. classifica paginas e extrai por papel
    IA-->>WI: paginas, titular, outorgantes, termoCompradores, compraVenda
    WI->>DB: applyExtractedFieldsToDraft. campos do rascunho
    WI->>DB: importDocumentBundle. corta o PDF e anexa nos slots
    WI->>DB: recordDocumentExtractionAudit. kind document_extraction
    WI->>QI: markIngestionDone. processing vira done
    WI-)RC: void reconcileOwnerType. so se markIngestionDone true
    end

    rect rgb(243,229,245)
    Note over RC,QQ: ATO 3 — Reconciliador. deriva tudo dos fatos, void best-effort
    RC->>DB: shadowDerive. gatherFacts e deriveProcessState puro
    RC->>DB: grava evidencia process_derivation
    RC->>DB: aplica ownerType. gated por autoApply e sem human-lock
    RC->>DB: applyConjuntoMatch. vincula conjunto, gated
    RC->>QQ: reconcileQuitacaoConsultas. set-diff dos CPFs do titular Caixa
    Note right of QQ: FILA DE QUITACAO NASCE AQUI, por CPF
    RC->>DB: reconcileProcessStatus. gates de PRONTA
    end

    rect rgb(232,245,233)
    Note over WR,CX: ATO 4 — Quitacao. worker RPA, paralelo
    loop poll claim a cada 5s
        WR->>API: GET claim
        API->>QQ: claimNextQuitacaoJob. CPFs ainda pending
        API-->>WR: processId e cpfs pendentes
    end
    loop cada CPF ate o primeiro quitado
        WR->>CX: consulta a quitacao do CPF
        CX-->>WR: quitado, nao encontrado ou erro
    end
    WR->>API: POST result. consultas por CPF e pdf do que quitou
    API->>DB: atualiza cada entrada. se quitado anexa a declaracao
    API-)RC: anexo da declaracao dispara void reconcile, reextract
    end
```

---

## 3. Estados da **fila de ingestão** (`process_batch_file.splitStatus`)

```mermaid
stateDiagram-v2
    [*] --> queued: INSERT no upload (scan/import)
    queued --> processing: claim (+lease +token, split_attempts+1)
    processing --> done: sucesso ✅
    processing --> queued: falha &lt; 5 (failIngestion, backoff)
    processing --> error: falha ≥ 5 (max_failures)
    processing --> error: ≥ 12 entregas sem concluir (crash-poison)
    processing --> queued: lease expirado (órfão re-reclamado)
    error --> queued: usuário "Reprocessar" (reprocessFailedIngestion)
    done --> [*]
    error --> [*]: terminal (dead-letter)
```

Fatos do código (`processes.ingestion.queue.ts`):
- **claim** (`claimNextIngestionJob`): pega `queued` elegível (sem lease/expirado, respeita backoff) **ou** `processing` órfão (lease expirado); `FOR UPDATE SKIP LOCKED`, `ORDER BY split_updated_at`. Incrementa **`split_attempts`** (entregas) e gera **novo fencing token**.
- **fencing token**: `markIngestionDone`/`failIngestion`/`deadLetterIngestion` só aplicam se o token ainda é o do worker — se perdeu o lease, casa 0 linhas e vira no-op (seguro com várias réplicas).
- **dois contadores**: `split_attempts` (entregas/claims) ≠ `split_failure_count` (falhas reais). `failIngestion` incrementa só o de falhas; órfão re-reclamado **não** consome orçamento de retry.
- **constantes**: `MAX_FAILURES=5`, `MAX_DELIVERIES=12`, lease `5min`, heartbeat `TTL/3`, backoff `30s·3^(n-1)` com teto `10min`.
- **worker** (`worker.ts`): poll `3s`, concorrência `2`, container `ingestion-worker` (`bun run worker`).

---

## 4. Estados do **processo** (fase de negócio)

```mermaid
stateDiagram-v2
    [*] --> RASCUNHO
    RASCUNHO --> CADASTRADO: identidade extraída (sem docs separados)
    CADASTRADO --> EM_DOCUMENTACAO: anexou documento
    EM_DOCUMENTACAO --> DOCUMENTACAO_PRONTA: requiredPending=0 + conjunto vinculado<br/>+ sem reviewFlag + sem job em voo + gates avaliados
    DOCUMENTACAO_PRONTA --> EM_DOCUMENTACAO: faltou doc / conjunto / reviewFlag CONHECIDO
    DOCUMENTACAO_PRONTA --> EM_PROCESSO: iniciar processo (manual)
    EM_PROCESSO --> FINALIZADO: finalizar (manual)
    EM_DOCUMENTACAO --> CANCELADO
    CADASTRADO --> CANCELADO
```

Gates de PRONTA (`syncProcessStatusAfterChecklistChange`):
- `checklistComplete = requiredPending === 0 && housingComplexId !== null`.
- `!reviewBlocked` (sem `reviewFlags`) e `!readinessPending` (nenhum job exigido em voo).
- **FAIL-CLOSED**: se a derivação dos gates lança, `gatesEvaluated=false` → **não promove** e **não reverte** um PRONTA existente (anti-flapping).
- **Reverte** PRONTA só por incompletude CONHECIDA (faltou doc, conjunto desvinculado, ou reviewFlag). `readinessPending` (job em voo) **não** reverte.

> `EM_DOCUMENTACAO` é exibido como **"Documentação pendente"**; *"Processando"* é badge de readiness, não fase.

---

## 5. Estados da **quitação** — por CPF (`quitacao_consultas` jsonb)

O titular do contrato Caixa pode ser **1–2 CPFs** (titular + cônjuge/co-comprador, ou os vendedores). Cada CPF tem seu próprio estado terminal.

```mermaid
stateDiagram-v2
    state "por CPF" as cpf {
        [*] --> pending: reconcile adiciona o CPF derivado
        pending --> quitado: emitiu o termo
        pending --> nao_encontrado: Caixa não achou
        pending --> erro: transitório (volta a pending até esgotar)
        erro --> pending: retry
    }
    note right of cpf
      Agregado caixa_quitacao_status:
      quitado > pending > erro > nao_encontrado
    end note
```

Fatos do código:
- `reconcileQuitacaoConsultas` (`derive/reconcile.ts`) faz **set-diff**: CPF novo → `pending`; CPF que continua → **preserva** a entrada (não re-consulta um terminal só porque o conjunto mudou); CPF removido → sai. Re-enfileira (zera attempts) só quando o agregado vira `pending`.
- **claim** (`claimNextQuitacaoJob`) devolve **a lista de CPFs `pending`** (não 1). Sem fallback para `process.cpf`.
- **worker RPA** (`worker/src/index.ts`): itera os CPFs, **para no 1º `quitado`** (short-circuit), guarda o PDF dele; reporta `/result` como `consultas[]` por CPF.
- `recordQuitacaoResult` atualiza por CPF (`nextConsultaStatus`) e preserva os demais; um `quitado` cujo **anexo da declaração falha NÃO vira terminal** — volta a `pending` (idempotente) até esgotar as tentativas (`MAX_ATTEMPTS=6`).

---

## 6. Onde/quando nasce **cada job e cada fila**

| Trabalho | "Fila" (onde vive) | Criado **quando** | Por quem (código) | Pego por |
|---|---|---|---|---|
| **Ingestão do PDF** | `process_batch_file.splitStatus='queued'` 📦 | no **upload** (scan/import) | `storeIngestionFile` / `completeDocumentImport` | `ingestion-worker` (poll 3s) 🟢 |
| **Reconciliação** (ownerType + conjunto + status + fila de quitação) | — (não é fila; `void`) | após **split `done`**; e em **cada anexo** de doc relevante; e na reanálise | `reconcileOwnerType` (via `reextractDocAndReconcile`) 🔴 | a própria **API**, `void` |
| **Quitação** | `process.quitacao_consultas` (jsonb por CPF) + `caixa_quitacao_status='pending'` 📦 | quando o **reconciliador deriva o(s) titular(es) do contrato Caixa** | `reconcileQuitacaoConsultas` | `worker` RPA (poll 5s via `/claim`) 🟢 |

> **Não existem** `enqueueQuitacaoCheck`, `startCaixaOwnerAnalysis` nem
> `startProcuracaoConjuntoAnalysis` — foram removidos. A ingestão **não** enfileira
> quitação; quem cria a fila é o reconciliador, só quando o titular Caixa é conhecido.

---

## 7. O reconciliador (`reconcileOwnerType`) — sequência

`void`/best-effort (nunca lança). Disparado pós-split (em `processClaimedIngestion`, após `markIngestionDone`) e por `reextractDocAndReconcile` (anexo de termo/declaração/procuração, e reanálise).

```mermaid
flowchart TB
    A[shadowDerive: gatherFacts + deriveProcessState puro] --> B[grava evidência process_derivation]
    B --> C{aplica ownerType?<br/>autoApply &amp; derived &amp; sem human-lock}
    C -->|sim| D[ownerType + source=system + history]
    C -->|não| E[só caixaAnalysisStatus = idle/done/review]
    D --> F[applyConjuntoMatch · gated · ANTES do status]
    E --> F
    F --> G[reconcileQuitacaoConsultas · set-diff por CPF]
    G --> H[reconcileProcessStatus · gates de PRONTA]
```

`gatherFacts` lê: linha `process`, `splitStatus` (job em voo), audits `document_extraction` (fonte primária dos papéis) + `caixa_owner` legado (fallback), checklist, e `housing_complex` (match do conjunto). `deriveProcessState` é **puro** e devolve `ownerType`, `quitacaoSubjects`, `requiredDocs`, `status` e `reviewFlags` (objetos `{code, titulo, detalhe, docKey}`). O checklist (`getProcessChecklist`) **expõe** os `reviewFlags` para o banner de pendências.

---

## 8. Robusto × frágil (a leitura honesta)

```mermaid
flowchart TB
    subgraph ROBUSTO["🟢 Bordas — fila durável + worker (sobrevive a crash)"]
        A[Ingestão do PDF<br/>process_batch_file + ingestion-worker]
        B[Quitação<br/>quitacao_consultas + worker RPA]
    end
    subgraph FRAGIL["🔴 Miolo — void na API, sem backstop"]
        C[reconcileOwnerType]
        D[reextractDocAndReconcile]
    end
    ROBUSTO -->|alimentam os fatos| FRAGIL
    FRAGIL -->|escrevem o estado derivado| F[(ownerType + conjunto + quitação + status)]
```

- **Bordas (🟢):** ingestão (fila `process_batch_file` + `ingestion-worker`) e quitação (`quitacao_consultas` + worker RPA) usam **fila + worker** — se cair, re-tentam sozinhas.
- **Miolo (🔴):** `reconcileOwnerType` e `reextractDocAndReconcile` rodam **`void` na API**, **sem backstop**. Se o gatilho se perder (crash entre `markIngestionDone` e o reconcile, ou promise rejeitada), o processo fica **"certo no cálculo, mas vazio no banco"** — e **abrir o processo não re-deriva**. O conserto estrutural pendente é **derivar na leitura** (ou um sweep level-triggered). Ver [`arch-process-derivation-v3`].

> Nota: existe um caminho **legado** de split inline (`startBatchFileSplit`/
> `runBatchFileSplit`, `void` + `setSplitStatus`) fora da fila durável; o fluxo atual
> de scan/import usa a **fila** descrita aqui.
