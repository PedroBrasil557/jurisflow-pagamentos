# Especificação: Sistema de Perfis de Permissão (ABAC)

> Documento de planejamento para implementação do sistema de controle de acesso baseado em perfis customizáveis.
> Revisado em: 2026-04-10

---

## 1. Visão geral

O sistema atual usa RBAC simples com três papéis fixos (`user`, `attorney`, `admin`). A nova implementação substitui esse modelo por **perfis de permissão customizáveis**, onde o administrador define quais ações cada grupo de usuários pode executar, além de controlar individualmente quais conjuntos habitacionais cada usuário pode visualizar e quais usuários ficam responsáveis pela documentação de processos específicos.

O `admin` continua sendo o único papel fixo no sistema, com acesso irrestrito a tudo. Todo o restante passa a ser controlado por perfis.

---

## 2. Conceitos do modelo

### 2.1 Perfil de permissão (`permission_profile`)

Um perfil agrupa um conjunto de permissões nomeado e reutilizável. Exemplos: "Agente de documentação", "Advogado", "Supervisor de lote".

Cada perfil define:
- **Escopo de visibilidade de processos** — o quanto o usuário enxerga
- **Permissões de ação** — o que o usuário pode fazer
- **Permissões de seção** — quais abas/áreas da interface são acessíveis
- **Conjuntos vinculados** — quais conjuntos habitacionais o perfil abrange (quando o escopo é `housing_complex`)

### 2.2 Escopo de visibilidade

| Valor | Significado |
|-------|-------------|
| `own` | Vê apenas processos que ele mesmo criou |
| `housing_complex` | Vê processos dos conjuntos vinculados ao perfil (+ os que criou) |
| `all` | Vê todos os processos da plataforma |

> **Exceção importante:** Independente do escopo do perfil, um usuário designado como **responsável pela documentação** de um processo específico sempre enxerga aquele processo e tem acesso à aba de documentação nele. Isso é tratado separadamente (seção 2.5).

### 2.3 Atribuição a usuários

Cada usuário não-admin tem **exatamente um perfil ativo** por vez. O admin pode:
- Trocar o perfil de um usuário a qualquer momento
- Vincular conjuntos habitacionais adicionais **diretamente ao usuário**, independente do perfil

A visibilidade efetiva de conjuntos de um usuário é a **união** de:
- Conjuntos vinculados ao seu perfil (quando `scope = housing_complex`)
- Conjuntos vinculados diretamente ao usuário

### 2.4 Perfis de sistema

Perfis marcados com `is_system = true` não podem ser deletados. São criados automaticamente na migração e servem como ponto de partida.

| Nome | Escopo | Destinado a |
|------|--------|-------------|
| Usuário Padrão | `own` | Todos os `user` atuais |
| Advogado | `all` | Todos os `attorney` atuais |

### 2.5 Responsabilidade de documentação por processo

O fluxo de documentação permite que a pessoa que criou o processo **não seja** a mesma que organiza os documentos no checklist. O admin pode designar um **responsável pela documentação** para cada processo, em dois níveis:

**Nível geral — via perfil:**
O perfil tem `uploadChecklist: true` e `sections.documentation: true`. O usuário pode lidar com a documentação de qualquer processo que ele consiga visualizar conforme seu escopo.

**Nível específico — por processo:**
O admin designa um usuário específico como `documentationAssigneeId` no processo. Esse usuário:
- Passa a **enxergar o processo** mesmo que normalmente não tivesse acesso (escopo `own` ou conjunto diferente)
- Acessa a aba de **documentação** desse processo
- Pode pegar arquivos enviados em lote pelo criador e organizá-los nos itens do checklist
- **Não** recebe automaticamente outras permissões além de documentação (ex: não pode cancelar, finalizar)

O admin pode remover essa designação e atribuir outro usuário a qualquer momento, desde que o processo não esteja em status terminal.

**Fluxo típico:**
```
Usuário A cria o processo
    ↓
Usuário A envia documentos brutos pela aba Lote
    ↓
Admin designa Usuário B como responsável pela documentação do processo
    ↓
Usuário B vê o processo e a aba Documentação
Usuário B organiza os arquivos do Lote nos itens do checklist
    ↓
Admin (ou Usuário B, se tiver permissão) marca documentação como pronta
```

---

## 3. Modelo de dados

### 3.1 Tabela `permission_profile`

```sql
permission_profile
  id                  text        PRIMARY KEY
  name                text        NOT NULL
  description         text
  is_system           boolean     DEFAULT false
  process_scope       enum        NOT NULL  -- 'own' | 'housing_complex' | 'all'
  permissions         jsonb       NOT NULL
  created_at          timestamp   NOT NULL
  updated_at          timestamp   NOT NULL
```

### 3.2 Tabela `profile_housing_complex`

Conjuntos vinculados a um perfil. Só é relevante quando `process_scope = 'housing_complex'`.

```sql
profile_housing_complex
  profile_id          text        FK → permission_profile.id  ON DELETE CASCADE
  housing_complex_id  text        FK → housing_complex.id     ON DELETE CASCADE
  PRIMARY KEY (profile_id, housing_complex_id)
```

### 3.3 Tabela `user_profile`

Atribuição ativa de perfil a um usuário. Um registro por usuário.

```sql
user_profile
  user_id             text        PRIMARY KEY  FK → user.id  ON DELETE CASCADE
  profile_id          text        NOT NULL     FK → permission_profile.id  ON DELETE RESTRICT
  assigned_at         timestamp   NOT NULL
  assigned_by_user_id text        FK → user.id  ON DELETE SET NULL
```

### 3.4 Tabela `user_housing_complex`

Conjuntos vinculados diretamente a um usuário, independente do perfil.

```sql
user_housing_complex
  user_id             text        FK → user.id             ON DELETE CASCADE
  housing_complex_id  text        FK → housing_complex.id  ON DELETE CASCADE
  granted_at          timestamp   NOT NULL
  granted_by_user_id  text        FK → user.id             ON DELETE SET NULL
  PRIMARY KEY (user_id, housing_complex_id)
```

### 3.5 Campo novo na tabela `process`

```sql
-- Modificação na tabela existente
ALTER TABLE process
  ADD COLUMN housing_complex_id    text  FK → housing_complex.id  ON DELETE RESTRICT,
  ADD COLUMN documentation_assignee_id  text  FK → user.id  ON DELETE SET NULL;
```

> `documentation_assignee_id` — usuário designado pelo admin para organizar a documentação deste processo. Nullable. Um usuário por processo. O admin pode trocar ou remover a qualquer momento (exceto em status terminal).

---

## 4. Estrutura do JSONB `permissions`

```ts
type ProfilePermissions = {
  process: {
    // Visibilidade e criação
    create: boolean                  // Criar novo processo
    viewOwn: boolean                 // Ver processos que criou (implícito quando scope = own)

    // Edição
    editOwn: boolean                 // Editar processos que criou
    editAny: boolean                 // Editar qualquer processo visível

    // Workflow jurídico
    startLegal: boolean              // Iniciar processo jurídico (DOCUMENTACAO_PRONTA → EM_PROCESSO)
    editLegal: boolean               // Editar dados jurídicos (número, valor, protocolo)
    finalize: boolean                // Finalizar processo (EM_PROCESSO → FINALIZADO)

    // Cancelamento
    cancelOwn: boolean               // Cancelar processos que criou
    cancelAny: boolean               // Cancelar qualquer processo visível

    // Documentação
    markDocumentationReady: boolean  // Marcar documentação como pronta manualmente
    uploadChecklist: boolean         // Enviar/organizar arquivos no checklist
    deleteChecklistFile: boolean     // Excluir arquivos do checklist

    // Lote
    viewBatch: boolean               // Ver arquivos enviados em lote
    uploadBatch: boolean             // Enviar arquivos no lote
    deleteBatch: boolean             // Excluir arquivos do lote

    // PDF
    generatePdf: boolean             // Gerar PDF do processo
  }
  sections: {
    dashboard: boolean               // Acessar página de dashboard
    checklist: boolean               // Ver aba de checklist (documentação organizada)
    documentation: boolean           // Ver aba de documentação (preenchimento/organização de itens)
    legalData: boolean               // Ver seção de dados jurídicos
    history: boolean                 // Ver histórico de movimentações
    batch: boolean                   // Ver aba de lote (arquivos brutos enviados)
  }
}
```

> **Nota sobre `documentation` vs `checklist`:**
> - `sections.batch` → aba onde o criador sobe arquivos brutos
> - `sections.documentation` → aba onde os itens do checklist são organizados pelo responsável
> - `sections.checklist` → visão de status consolidado do checklist (pode ser uma terceira aba ou a mesma de documentação com layout diferente — a definir no design)

### 4.1 Valores padrão por perfil de sistema

**Usuário Padrão** (`scope: own`):

```json
{
  "process": {
    "create": true,
    "viewOwn": true,
    "editOwn": true,
    "editAny": false,
    "startLegal": false,
    "editLegal": false,
    "finalize": false,
    "cancelOwn": true,
    "cancelAny": false,
    "markDocumentationReady": false,
    "uploadChecklist": false,
    "deleteChecklistFile": false,
    "viewBatch": true,
    "uploadBatch": true,
    "deleteBatch": false,
    "generatePdf": false
  },
  "sections": {
    "dashboard": true,
    "checklist": true,
    "documentation": false,
    "legalData": false,
    "history": true,
    "batch": true
  }
}
```

**Advogado** (`scope: all`):

```json
{
  "process": {
    "create": true,
    "viewOwn": true,
    "editOwn": true,
    "editAny": true,
    "startLegal": true,
    "editLegal": true,
    "finalize": true,
    "cancelOwn": true,
    "cancelAny": true,
    "markDocumentationReady": true,
    "uploadChecklist": true,
    "deleteChecklistFile": true,
    "viewBatch": true,
    "uploadBatch": true,
    "deleteBatch": true,
    "generatePdf": true
  },
  "sections": {
    "dashboard": true,
    "checklist": true,
    "documentation": true,
    "legalData": true,
    "history": true,
    "batch": true
  }
}
```

---

## 5. Resolução de permissões efetivas

A função `resolveUserPermissions(userId)` é o ponto central do sistema. Ela retorna o objeto que todos os guards e serviços usam para tomar decisões.

```ts
type ResolvedPermissions = {
  isAdmin: boolean
  processScope: 'own' | 'housing_complex' | 'all'
  allowedHousingComplexIds: string[]   // union: perfil + usuário individual
  permissions: ProfilePermissions
  profileId: string | null
  profileName: string | null
}
```

### 5.1 Algoritmo de resolução

```
1. Busca o user.role
   → se 'admin': retorna { isAdmin: true, ... } e encerra (bypass total)

2. Busca user_profile WHERE user_id = userId
   → se não encontrado: aplica permissões do perfil "Usuário Padrão"

3. Busca permission_profile + profile_housing_complex do perfil

4. Busca user_housing_complex WHERE user_id = userId

5. allowedHousingComplexIds = union(
     perfil.housing_complexes,
     user.housing_complexes
   )

6. Retorna ResolvedPermissions com os dados combinados
```

### 5.2 Lógica de visibilidade de processos

Na query de `listProcesses`, o filtro aplicado considera escopo **e** designação de documentação:

| Condição | Filtro SQL |
|----------|-----------|
| `isAdmin` | sem filtro |
| `scope = all` | sem filtro |
| `scope = housing_complex` | `WHERE hc_id IN (:ids) OR created_by = :userId OR doc_assignee = :userId` |
| `scope = own` | `WHERE created_by = :userId OR doc_assignee = :userId` |

> O usuário sempre vê os processos onde é `documentation_assignee_id`, independente do escopo.

### 5.3 Permissões efetivas dentro de um processo específico

Ao acessar um processo individual, as permissões dependem de **quem o usuário é** em relação àquele processo:

```ts
type ProcessRelationship = {
  isCreator: boolean              // process.created_by_user_id === userId
  isDocumentationAssignee: boolean // process.documentation_assignee_id === userId
  isInScope: boolean              // o processo está no escopo de visibilidade geral
}
```

Com isso, as permissões por ação dentro de um processo específico seguem:

| Ação | Condição |
|------|----------|
| `editOwn` | `isCreator && perms.editOwn` |
| `editAny` | `isInScope && perms.editAny` |
| `uploadChecklist` | `(isInScope \|\| isDocumentationAssignee) && perms.uploadChecklist` |
| `sections.documentation` | `(isInScope \|\| isDocumentationAssignee) && perms.sections.documentation` |
| `sections.batch` | `(isInScope \|\| isCreator) && perms.sections.batch` |
| `cancelOwn` | `isCreator && perms.cancelOwn` |
| `cancelAny` | `isInScope && perms.cancelAny` |
| `startLegal` / `editLegal` / `finalize` | `isInScope && perms.[action]` (nunca pelo assignee sozinho) |

---

## 6. Estratégia de migração

A migração acontece em **uma única migration Drizzle** com os seguintes passos sequenciais:

### Passo 1 — Criar novas tabelas
Cria `permission_profile`, `profile_housing_complex`, `user_profile`, `user_housing_complex`.

### Passo 2 — Migrar campo `housing_complex` em `process`
Adiciona coluna `housing_complex_id` (FK para `housing_complex`) e popula a partir do nome de texto existente. Adiciona coluna `documentation_assignee_id` (nullable).

> **Atenção:** O campo `housing_complex` é atualmente texto livre no processo. Antes de executar a migration, é necessário auditar os dados existentes para garantir que todos os valores de texto correspondam exatamente a nomes de conjuntos cadastrados. Processos sem correspondência precisam de tratamento manual.

### Passo 3 — Inserir perfis de sistema
Insere os dois perfis de sistema (`Usuário Padrão`, `Advogado`) com os JSONs definidos na seção 4.1.

### Passo 4 — Atribuir perfis aos usuários existentes

```sql
-- Todos os 'attorney' recebem perfil Advogado
INSERT INTO user_profile (user_id, profile_id, assigned_at)
SELECT id, '<id-perfil-advogado>', NOW()
FROM "user" WHERE role = 'attorney';

-- Todos os 'user' recebem perfil Usuário Padrão
INSERT INTO user_profile (user_id, profile_id, assigned_at)
SELECT id, '<id-perfil-usuario-padrao>', NOW()
FROM "user" WHERE role = 'user';

-- admin: nenhum registro em user_profile (bypass via role)
```

### Passo 5 — Manter compatibilidade
O campo `role` em `user` continua existindo. O valor `'attorney'` torna-se legado mas não é removido nesta migration. A remoção fica para uma sprint posterior após remoção de todas as referências a `requireRole('attorney')`.

---

## 7. Camadas de enforcement

### 7.1 API — pipeline de verificação

```
Requisição
    ↓
sessionMiddleware               → carrega user da sessão
    ↓
requireAuth()                   → 401 se não autenticado
    ↓
resolveUserPermissions(userId)  → carrega ResolvedPermissions
    ↓
assertCan(perms, 'action')      → 403 se permissão ausente no perfil
    ↓
[para ações por processo]
assertProcessPermission(        → 403 se a relação usuário↔processo não permite
  perms, relationship, 'action'
)
    ↓
Lógica de negócio (serviço)
```

### 7.2 Funções de assertion

```ts
// Verifica permissão genérica do perfil
function assertCan(
  perms: ResolvedPermissions,
  action: keyof ProfilePermissions['process'],
): void

// Verifica permissão considerando a relação com o processo específico
function assertProcessAction(
  perms: ResolvedPermissions,
  relationship: ProcessRelationship,
  action: 'editOwn' | 'editAny' | 'uploadChecklist' | 'cancelOwn' | 'cancelAny' | ...,
): void

// Verifica se o usuário pode ver a aba de documentação deste processo
function assertCanAccessDocumentation(
  perms: ResolvedPermissions,
  relationship: ProcessRelationship,
): void
```

### 7.3 API — filtro de visibilidade em `listProcesses`

```ts
async function listProcesses(query, userId: string, perms: ResolvedPermissions) {
  const baseQuery = db.select().from(process)

  if (!perms.isAdmin && perms.processScope !== 'all') {
    if (perms.processScope === 'housing_complex') {
      baseQuery.where(
        or(
          inArray(process.housingComplexId, perms.allowedHousingComplexIds),
          eq(process.createdByUserId, userId),
          eq(process.documentationAssigneeId, userId),
        )
      )
    } else {
      // scope = 'own'
      baseQuery.where(
        or(
          eq(process.createdByUserId, userId),
          eq(process.documentationAssigneeId, userId),
        )
      )
    }
  }
  // ...
}
```

### 7.4 Frontend — permissões no contexto de rota

O objeto `ResolvedPermissions` é retornado junto com a sessão via `GET /api/session`, disponível em todo o app sem chamadas extras.

```ts
// Contexto de _protected.tsx
{
  session,
  user,
  permissions: ResolvedPermissions  // novo
}
```

---

## 8. Rotas da API — novas e modificadas

### 8.1 Novas rotas de perfis (protegidas por `requireRole('admin')`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/admin/profiles` | Listar perfis com paginação e busca |
| `POST` | `/api/admin/profiles` | Criar novo perfil |
| `GET` | `/api/admin/profiles/:profileId` | Detalhe: permissões, conjuntos, usuários |
| `PATCH` | `/api/admin/profiles/:profileId` | Atualizar nome, descrição, escopo e permissões |
| `DELETE` | `/api/admin/profiles/:profileId` | Deletar (bloqueado se `is_system` ou com usuários) |
| `PUT` | `/api/admin/profiles/:profileId/housing-complexes` | Substituir lista de conjuntos do perfil |
| `GET` | `/api/admin/profiles/:profileId/users` | Usuários com este perfil |

### 8.2 Novas rotas de usuário (protegidas por `requireRole('admin')`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `PUT` | `/api/admin/users/:userId/profile` | Atribuir ou trocar perfil |
| `GET` | `/api/admin/users/:userId/housing-complexes` | Listar conjuntos individuais |
| `PUT` | `/api/admin/users/:userId/housing-complexes` | Substituir conjuntos individuais |

### 8.3 Novas rotas de processo (protegidas por `requireAuth()`)

| Método | Rota | Descrição |
|--------|------|-----------|
| `PUT` | `/api/processes/:processId/documentation-assignee` | Designar responsável pela documentação (apenas admin) |
| `DELETE` | `/api/processes/:processId/documentation-assignee` | Remover designação (apenas admin) |

### 8.4 Rota modificada — `GET /api/session`

Passa a incluir `permissions: ResolvedPermissions` na resposta quando autenticado.

### 8.5 Rotas modificadas — processos

Todas as rotas que usavam `assertAttorneyOrAdmin` passam a usar `resolveUserPermissions` + `assertCan`/`assertProcessAction`.

---

## 9. Interface de usuário

### 9.1 Nova aba em Cadastros — "Permissões"

A página `RegistersPage` ganha uma terceira aba no `SettingsLayout`:

```
Cadastros
├── Usuarios
├── Conjuntos
└── Permissoes  ← novo
```

### 9.2 Página de listagem de perfis

Conteúdo:
- Tabela de perfis com: nome, escopo, quantidade de usuários, badge "sistema" quando `is_system`
- Botão "Novo perfil"
- Ações por linha: "Editar", "Ver usuários", "Excluir" (bloqueado para `is_system` com usuários)

### 9.3 Formulário de criação/edição de perfil

Campos:
- **Nome** (obrigatório)
- **Descrição** (opcional)
- **Escopo de processos** — radio: "Apenas próprios" / "Por conjunto" / "Todos"
- **Conjuntos habilitados** — multi-select, visível apenas quando escopo = "Por conjunto"
- **Permissões** — checkboxes agrupados (ver abaixo)

Grupos de checkboxes:

```
Processos
  [ ] Criar processo
  [ ] Editar processos próprios
  [ ] Editar qualquer processo visível

Workflow jurídico
  [ ] Iniciar processo jurídico
  [ ] Editar dados jurídicos
  [ ] Finalizar processo

Cancelamento
  [ ] Cancelar processos próprios
  [ ] Cancelar qualquer processo visível

Lote de documentos
  [ ] Ver arquivos do lote
  [ ] Enviar arquivos no lote
  [ ] Excluir arquivos do lote

Documentação (checklist)
  [ ] Organizar itens do checklist
  [ ] Excluir arquivos do checklist
  [ ] Marcar documentação como pronta

Outras ações
  [ ] Gerar PDF

Seções visíveis
  [ ] Dashboard
  [ ] Aba de lote
  [ ] Aba de documentação
  [ ] Dados jurídicos
  [ ] Histórico
```

> Itens com dependência (ex: "Excluir arquivos" requer "Organizar checklist") mostram aviso visual quando a combinação é incoerente.

### 9.4 Detalhe do perfil

Tela ao clicar no perfil contendo:
- Dados e permissões (modo leitura + botão "Editar")
- Lista de usuários com este perfil, com botão de trocar perfil diretamente
- Lista de conjuntos vinculados

### 9.5 Painel do usuário — edição pelo admin

O diálogo `EditUserDialog` existente ganha duas novas seções:

**Seção: Perfil de acesso**
- Select com lista de perfis disponíveis (obrigatório para não-admin)
- Exibe nome e escopo do perfil selecionado

**Seção: Conjuntos adicionais**
- Multi-select de conjuntos para vincular diretamente ao usuário
- Aparece com legenda "Além dos conjuntos já incluídos no perfil"
- Útil quando um usuário precisa de acesso pontual a um conjunto fora do seu perfil

### 9.6 Designação de responsável por documentação no processo

Na tela de detalhes/edição do processo, uma nova seção aparece apenas para admin:

**Responsável pela documentação**
- Select de usuário (busca por nome/CPF)
- Mostra o usuário atual se já designado, com botão "Remover"
- Aparece em status: `EM_DOCUMENTACAO`, `DOCUMENTACAO_PRONTA`
- Oculta em status terminal (`FINALIZADO`, `CANCELADO`)

Essa ação gera entrada no histórico: `DOCUMENTATION_ASSIGNEE_SET` / `DOCUMENTATION_ASSIGNEE_REMOVED`.

### 9.7 Badge de perfil na listagem de usuários

A coluna "Perfil" deixa de mostrar o `role` bruto e passa a mostrar o nome do perfil atribuído. Admin continua mostrando "Administrador" como caso especial fixo.

---

## 10. Novos tipos de evento no histórico de processo

```ts
// Adicionar em processHistoryEventTypes:
'DOCUMENTATION_ASSIGNEE_SET'      // Admin designou responsável pela documentação
'DOCUMENTATION_ASSIGNEE_REMOVED'  // Admin removeu responsável pela documentação
```

---

## 11. Arquivos a criar

### API

```
api/src/modules/permissions/
  permissions.schema.ts           ← Drizzle: 4 novas tabelas
  permissions.types.ts            ← ProfilePermissions, ResolvedPermissions, ProcessRelationship
  permissions.defaults.ts         ← JSONs dos perfis de sistema (Usuário Padrão, Advogado)
  permissions.service.ts          ← resolveUserPermissions(), assertCan(), assertProcessAction()
  permissions.admin.service.ts    ← CRUD de perfis, atribuição usuário↔perfil, conjuntos individuais
  permissions.admin.routes.ts     ← /api/admin/profiles/*, /api/admin/users/*/profile
  permissions.schemas.ts          ← schemas Zod

api/src/db/migrations/
  XXXX_permissions_system.ts      ← migration: tabelas + housing_complex_id + documentation_assignee_id + seed
```

### Web

```
web/src/features/permissions/
  services/
    permissions.service.ts
    permissions.queries.ts
    permissions.mutations.ts
  components/
    profile-list-table.tsx
    profile-form.tsx
    profile-permissions-editor.tsx
    profile-housing-complexes-selector.tsx
    profile-users-table.tsx
    user-profile-selector.tsx
    user-housing-complexes-editor.tsx
    process-documentation-assignee.tsx  ← painel de designação no processo
  pages/
    permissions-page.tsx
```

---

## 12. Arquivos a modificar

### API

| Arquivo | Mudança |
|---------|---------|
| `auth.routes.ts` | `GET /session` inclui `permissions` na resposta |
| `processes.routes.ts` | Passa `perms` e `userId` para serviços; adiciona rotas de assignee |
| `processes.service.ts` | `assertAttorneyOrAdmin` → `assertProcessAction`. `listProcesses` filtra por escopo + assignee |
| `processes.checklist.service.ts` | Verifica `assertCanAccessDocumentation` + `uploadChecklist` |
| `processes.batch.service.ts` | Verifica `viewBatch`, `uploadBatch`, `deleteBatch` |
| `processes.pdf.service.ts` | Verifica `generatePdf` |
| `processes.status.ts` | Adiciona `DOCUMENTATION_ASSIGNEE_SET`, `DOCUMENTATION_ASSIGNEE_REMOVED` |
| `processes.schema.ts` | Adiciona `housing_complex_id`, `documentation_assignee_id` |
| `admin.routes.ts` | Adiciona rotas de perfil e conjuntos do usuário |
| `routes/index.ts` | Registra `permissions.admin.routes` |

### Web

| Arquivo | Mudança |
|---------|---------|
| `_protected.tsx` | Expõe `permissions` no contexto de rota |
| `process-actions.tsx` | Usa `permissions` do contexto em vez de `legalRoles` hardcoded |
| `authenticated-layout.navigation.ts` | Visibilidade de menu usa `permissions.sections` |
| `registers-page.tsx` | Adiciona aba "Permissões" |
| `edit-user-dialog.tsx` | Adiciona seletor de perfil e conjuntos individuais |
| `admin-users.service.ts` | Inclui `profileName` e `profileId` no tipo `AdminUserListItem` |
| Página de edição do processo | Adiciona seção de responsável pela documentação (apenas admin) |

---

## 13. Ordem de implementação

### Fase 1 — Fundação (banco e tipos)
1. Schema Drizzle das novas tabelas (`permissions.schema.ts`)
2. Migration completa: tabelas + campos em `process` + seed de perfis + atribuição de usuários existentes
3. Tipos TypeScript (`permissions.types.ts`, `permissions.defaults.ts`)

### Fase 2 — Engine de permissões (API)
4. `resolveUserPermissions()` + `assertCan()` + `assertProcessAction()`
5. Adaptar `GET /api/session` para incluir `permissions`
6. Adaptar `listProcesses` para filtrar por escopo + assignee
7. Substituir `assertAttorneyOrAdmin` por `assertProcessAction` em todos os serviços
8. Adicionar rotas de designação de responsável (`PUT/DELETE /processes/:id/documentation-assignee`)

### Fase 3 — CRUD de perfis (API)
9. `permissions.admin.service.ts` — CRUD de perfis e conjuntos do perfil
10. `permissions.admin.service.ts` — atribuição perfil→usuário e conjuntos individuais
11. `permissions.admin.routes.ts` + registro no roteador

### Fase 4 — Interface de perfis (Web)
12. `permissions.service.ts`, `.queries.ts`, `.mutations.ts`
13. `profile-permissions-editor.tsx`
14. `profile-form.tsx`
15. `permissions-page.tsx`
16. Adicionar aba "Permissões" em `registers-page.tsx`

### Fase 5 — Integração no usuário (Web)
17. `user-profile-selector.tsx` + `user-housing-complexes-editor.tsx`
18. Atualizar `edit-user-dialog.tsx`
19. Atualizar coluna "Perfil" na listagem de usuários

### Fase 6 — Consumo de permissões no frontend
20. Expor `permissions` no contexto de rota (`_protected.tsx`)
21. Adaptar `process-actions.tsx`
22. Adaptar visibilidade de navegação
23. Adaptar visibilidade de abas internas do processo

### Fase 7 — Designação de documentação (Web)
24. `process-documentation-assignee.tsx`
25. Integrar no formulário/detalhe do processo
26. Exibir assignee atual na listagem de processos (coluna ou indicador)

---

## 14. Decisões em aberto

| # | Questão | Impacto |
|---|---------|---------|
| 1 | O campo `housing_complex` em `process` é texto livre. Auditar dados existentes antes da migration para garantir correspondência nome→id. | Alta |
| 2 | Se um usuário não tem `user_profile`, o sistema aplica "Usuário Padrão" silenciosamente ou bloqueia até o admin atribuir um? Sugestão: aplicar "Usuário Padrão" silenciosamente para não travar o acesso. | Média |
| 3 | Um perfil `is_system` pode ter suas permissões editadas pelo admin? Sugestão: não, apenas perfis criados pelo admin são editáveis. O admin pode duplicar um perfil de sistema para customizar. | Baixa |
| 4 | Ao deletar um perfil que tem usuários: bloquear a deleção ou mover usuários para o "Usuário Padrão"? Sugestão: bloquear e exibir quantos usuários seriam afetados. | Média |
| 5 | O `documentation_assignee_id` pode ser um usuário com `scope = own` que normalmente não veria o processo? Sim — essa é a intenção. O assignee sempre enxerga o processo para o qual foi designado. | Alta |
| 6 | Deve haver um histórico de trocas de assignee (quem designou, quando, quem era antes)? Sugestão: sim, já contemplado com os novos event types no histórico. | Baixa |
| 7 | A remoção do role `'attorney'` do enum `user_role` fica para sprint posterior, após remover todas as referências em código. | Baixa |
