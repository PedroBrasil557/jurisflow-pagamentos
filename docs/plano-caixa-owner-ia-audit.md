# Plano — Detecção automática do titular do contrato Caixa + Camada de evidência de IA (v3)

> Documento de planejamento. Arquitetura revisada (v3). Atualizar conforme a implementação avança.

## 0. Princípios
- **Aditivo e reversível** (nada altera fluxo em produção).
- **Operacional ≠ evidência** (responsabilidades separadas).
- **LLM extrai, código decide** (determinístico/testável).
- **Abstração emerge** (sem framework genérico antes do 2º consumidor real).
- **Proveniência explícita** no `ownerType`.
- **Shadow + feature flag** antes de auto-aplicar.

## 1. Arquitetura-alvo
```
anexo/substituição de (termo_entrega_recebimento_imovel | declaracao_quitacao)
   → process.caixaAnalysisStatus = 'processing'   (estado operacional, durável, sweep no boot)
   → job em background (NÃO bloqueia o upload)
        → [helper Anthropic NOVO] extrai {nome, cpf, trecho}        ← única parte probabilística
        → [comparador PURO]  normalizeCpf / normalizeName            ← 100% testável, sem rede
              exato? → 'titular'  |  senão / divergência → 'review'  (nunca auto "não titular")
        → TRANSAÇÃO ÚNICA:
              insert ai_analysis (1x, imutável)
              + se flag ON e match: update ownerType + ownerTypeSource='system'
              + evento de histórico (metadata.aiAnalysisId), ator = jurisflow-bot
              + set caixaAnalysisStatus = 'done' | 'review' | 'error'
   → UI: badge no checklist + "ver evidência"
```

## 2. FASE 0 — Fundação (camada de evidência) — sem chamada de modelo

### 2.1 Tabela `ai_analysis` (módulo leaf `api/src/modules/ai-analysis`) — append-only
| Coluna | Tipo | Nota |
|---|---|---|
| id | text PK | gerado no service |
| kind | text notNull | `'caixa_owner'`, `'document_extraction'`… |
| processId | text notNull FK→process.id **onDelete restrict** | evidência sobrevive |
| context | jsonb | `{documentKey, fileId, revision, contentSha256}` |
| model | text notNull | `message.model` resolvido (não o alias) |
| promptVersion | text notNull | hash de (system+tool) |
| input | jsonb | minimizado: referência + snapshot do titular; nunca bytes |
| output | jsonb | extração validada (Zod) + trecho-fonte |
| decision | jsonb | `{result:'titular'\|'review', matchedBy:'cpf'\|'name'\|'none', compradores:[…]}` |
| confidence | smallint null | só evidência — não decide |
| status | text notNull | `'ok'` \| `'error'` (sem `pending`: operacional fica no processo) |
| errorMessage | text null | nunca PII bruta |
| tokensInput/Output | integer null | custo |
| durationMs | integer null | |
| triggerSource | text notNull | `'system'` \| `'user'` |
| triggeredByUserId | text null FK→user.id restrict | humano que anexou |
| createdAt | timestamp defaultNow notNull | sem updatedAt (append-only) |

Índices: `(processId, createdAt desc)`, `(kind, createdAt desc)`.

### 2.2 `recordAiAnalysis(tx, {...})`
Função simples: um INSERT (aceita executor/tx). Sem `runAiCall`/`summarize`/`finally`. Cada rotina futura só chama isto.

### 2.3 Endpoints (process-scoped; acesso = ver o processo)
- `GET /processes/:processId/ai-analyses?kind=&limit=` → lista resumida (sem output/input).
- `GET /processes/:processId/ai-analyses/:id` → completo.
- Fix IDOR: filtra por `(id E processId)` → 404 se não casar. Zod com bounds.

### 2.4 Imutabilidade real
`REVOKE UPDATE, DELETE` da role da app sobre `ai_analysis`.

### 2.5 Histórico
Reusar campo de metadados se existir; senão `metadata jsonb` genérico (uma vez), com shape tipado no código.

### 2.6 CI test gate (hoje não existe)
`"test":"bun test"` na api + step no CI antes do deploy + `drizzle-kit generate --check`. Migrações aditivas.

### 2.7 Seed
Usuário técnico `jurisflow-bot` (sem login interativo) como ator dos eventos do sistema.

## 3. FASE 1 — Primeiro consumidor: Caixa Owner (em shadow)
- **Docs-fonte:** `termo_entrega_recebimento_imovel` e/ou `declaracao_quitacao` (já existem). Cross-check; divergência → `review`.
- **Helper Anthropic novo** (não tocar na extração de produção): extrai só `compradores[]: {nome, cpf, trechoFonte, origem}`. Não passa `temperature` (removido no Opus 4.x → 400). Captura `message.model`+`usage`. Valida com Zod safeParse → falhou ⇒ `error`/`review`.
- **Comparador determinístico** (puro, `shared/utils`, com testes): CPF válido e igual → titular (`matchedBy:'cpf'`); senão sem CPF e nome idêntico → titular (`matchedBy:'name'`); 2 compradores → bate com qualquer; senão → `review`.
- **Estado operacional + proveniência:** `process.caixaAnalysisStatus` (`idle|processing|done|review|error`, reset de órfãos no boot) + `process.ownerTypeSource` (`human|system`, habilita human-lock).
- **Gatilho durável + atomicidade:** anexo/substituição → processing → job → transação única (record + apply + history + status). Retry só p/ 429/5xx/timeout. Botão "Reanalisar".
- **UX:** badge (Titular ✓ / Revisar ⚠ / Erro) + "ver evidência". `review` vira flag + evento `CAIXA_OWNER_REVIEW_REQUIRED`.
- **Shadow:** flag `caixaOwnerAutoApply` (settings) desligada por padrão.

## 4. FASE 2 — Ligar + consolidar
Ligar auto-aplicação após shadow (nunca auto "não titular") · retrofit da extração à camada · extrair helper Anthropic compartilhado · **LGPD** (retenção/expurgo/crypto-shredding) nesta fase mais madura.

## 5. Segurança de produção
Aditivo · feature flag + shadow · nunca auto "não titular" · REVOKE update/delete · IDOR fix · CI test gate · migrações aditivas com `--check`.

## 6. Decisões
**Resolvidas:** LLM-extrai/código-decide · 2 docs-fonte · sem delete físico (FK restrict) · gate = escopo do processo · `metadata jsonb` no histórico · shadow+flag · human-lock via `ownerTypeSource` · estado operacional ≠ evidência · sem `runAiCall` · ator = `jurisflow-bot` · LGPD adiada p/ fase madura (só minimização gratuita agora: nunca guardar bytes do doc).

## 7. Critérios de aceite
- **Fase 0:** grava/lê evidência via `recordAiAnalysis` (teste ok+erro), IDOR-safe, imutável no banco, CI rodando testes. Zero chamada de modelo.
- **Fase 1:** comparador puro 100% testado; análise em shadow registra evidência sem tocar `ownerType`; órfãos resetam no boot.
- **Fase 2:** auto-aplicação atrás de flag, idempotente, atômica, com proveniência e histórico.

## 8. Mapa de arquivos
```
api/src/modules/ai-analysis/        (Fase 0 — leaf)
  ai-analysis.schema.ts | .schemas.ts | .service.ts | .routes.ts
api/src/shared/utils/name.ts        (Fase 1 — normalizeName)
api/src/modules/processes/
  processes.schema.ts               (+caixaAnalysisStatus, +ownerTypeSource, +process_history.metadata)
  processes.caixa-owner.service.ts  (Fase 1)
  + helper Anthropic novo           (Fase 1)
web/src/features/ai-analysis/       (Fase 0 — viewer reutilizável)
web/src/features/processes/...      (Fase 1 — badge/evidência no checklist)
```
