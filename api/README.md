# API — JurisFlow

Backend do JurisFlow. API REST construída com Hono sobre o runtime Bun, com persistência em PostgreSQL via Drizzle ORM, armazenamento de arquivos no MinIO e autenticação por sessão via better-auth.

## Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | [Bun](https://bun.sh/) |
| Framework HTTP | [Hono](https://hono.dev/) |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) |
| Banco de dados | PostgreSQL 18 |
| Autenticação | [better-auth](https://www.better-auth.com/) |
| Armazenamento | MinIO (S3-compatible) via AWS SDK v3 |
| Geração de PDF | pdf-lib + docx-templates + LibreOffice |
| Validação | Zod |
| Lint/Format | Biome |

## Estrutura de Diretórios

```
api/src/
├── index.ts              # Entry point — inicia servidor Bun na porta configurada
├── app.ts                # Factory que cria a app Hono com allowedOrigins
├── routes/
│   └── index.ts          # Roteador raiz: session + CORS + logger + todos os módulos
├── modules/              # Domínios da aplicação
│   ├── auth/             # Autenticação e gerenciamento de usuários
│   ├── processes/        # Processos jurídicos (módulo principal)
│   ├── housing-complexes/# Conjuntos habitacionais MCMV
│   ├── dashboard/        # Estatísticas e KPIs
│   ├── admin/            # Funções administrativas
│   └── system/           # Health check
└── shared/               # Utilitários compartilhados (sem lógica de domínio)
    ├── config/env.ts     # Variáveis de ambiente validadas com Zod
    ├── db/               # Conexão Drizzle + schema central
    ├── storage/s3.ts     # Cliente MinIO e helpers de chave de objeto
    ├── errors/service-error.ts  # Classe base para todos os erros de serviço
    ├── middleware/
    │   ├── auth-guard.ts # requireAuth(), requireRole(), getAuthenticatedUser()
    │   ├── error-handler.ts     # handleServiceError() — resposta centralizada de erro
    │   ├── logger.ts     # requestLogger() — loga método, path, status, duração
    │   ├── cors.ts       # Middleware CORS
    │   └── session.ts    # Extrai sessão better-auth para o contexto Hono
    ├── types/app.ts      # AppBindings — tipo do contexto Hono (user, session)
    ├── validation/validators.ts # jsonValidator, queryValidator, paramsValidator
    └── utils/
        ├── cpf.ts        # isValidCpf(), normalizeCpf()
        └── file-name.ts  # Helpers de nomenclatura de arquivos
```

## Padrão de Rota

Cada rota segue este fluxo linear:

```
Route (Hono)
  → Validator (jsonValidator / queryValidator / paramsValidator)
  → Auth middleware (requireAuth / requireRole)
  → Service function (lança ServiceError em caso de erro)
  → Drizzle query
  → JSON response  ← handleServiceError() intercepta ServiceError
```

### Exemplo prático

```typescript
// routes.ts
processesRouter.patch(
  '/:processId',
  paramsValidator(processIdSchema),
  jsonValidator(updateProcessSchema),
  requireAuth(),
  async (c) => {
    const { processId } = c.req.valid('param')
    const body = c.req.valid('json')
    const user = getAuthenticatedUser(c)
    const process = await updateProcess(processId, body, user)
    return c.json(process)
  }
)

// service.ts
export async function updateProcess(id: string, data: UpdateProcessInput, user: User) {
  const process = await getProcessById(id)
  if (!process) throw new ProcessNotFoundError()
  assertProcessCanBeEdited(process) // lança ServiceError se terminal
  // ...lógica de negócio
}
```

### Regras das camadas

| Camada | Responsabilidade |
|--------|----------------|
| `routes.ts` | Orchestração: valida, autentica, chama service, retorna JSON |
| `service.ts` | Lógica de negócio; lança `ServiceError` para qualquer erro esperado |
| `schemas.ts` | Schemas Zod para validação de entrada (API) |
| `schema.ts` | Definição das tabelas Drizzle (banco de dados) |
| `errors.ts` | Classes de erro específicas do módulo, extendendo `ServiceError` |

**Nunca:**
- Escrever lógica de negócio em `routes.ts`
- Fazer queries Drizzle fora da camada de service
- Duplicar validators, auth guards ou error handlers — usar sempre os de `shared/`

## Módulos

### `auth/` — Autenticação

Configura e expõe o better-auth com as seguintes características:

- **Identificador de login:** CPF (username plugin) — normalizado e validado
- **Campos extras no usuário:** `role` (user | admin | attorney), `mustChangePassword`, `isActive`
- **Email+password:** habilitado com auto sign-in
- **Hooks de cadastro:** validam o CPF no momento do registro
- **Host público:** `BETTER_AUTH_URL` deve apontar para a origem pública do app web, porque o navegador acessa auth via proxy same-origin em `'/api/auth/*'`

Endpoints gerados automaticamente pelo better-auth em `/api/auth/*` (sign-in, sign-up, sign-out, session).

Gerenciamento administrativo de usuários está em `admin/` (criar, editar, resetar senha).

### `processes/` — Processos Jurídicos

Módulo principal do sistema. Gerencia o ciclo de vida completo de um processo:

**Arquivos:**

| Arquivo | Conteúdo |
|---------|---------|
| `processes.schema.ts` | Tabelas: `process`, `processDocument`, `processDocumentFile`, `processHistory` |
| `processes.schemas.ts` | Schemas Zod para todas as entradas (200+ linhas) |
| `processes.status.ts` | Máquina de estados: transições válidas, `isTerminalProcessStatus()` |
| `processes.documents.ts` | Definição dos tipos de documento exigidos e sua ordem |
| `processes.service.ts` | CRUD e transições de status |
| `processes.checklist.service.ts` | Upload, exclusão e download de documentos do checklist |
| `processes.batch.service.ts` | Upload em lote de arquivos |
| `processes.pdf.service.ts` | Listagem de modelos e geração de PDF |
| `processes.errors.ts` | `ProcessNotFoundError`, `ProcessServiceError`, etc. |
| `processes.routes.ts` | 13+ endpoints REST |

**Endpoints principais:**

```
GET    /api/processes                       Lista com busca, filtro e paginação
POST   /api/processes                       Cria processo
GET    /api/processes/:id                   Detalhe
PATCH  /api/processes/:id                   Atualiza dados pessoais/endereço
POST   /api/processes/:id/start             Inicia processo jurídico (attorney/admin)
PATCH  /api/processes/:id/legal             Atualiza dados jurídicos (attorney/admin)
POST   /api/processes/:id/finalize          Finaliza (attorney/admin)
POST   /api/processes/:id/cancel            Cancela (attorney/admin)
GET    /api/processes/:id/checklist         Lista documentos do checklist
POST   /api/processes/:id/checklist/:docId/submit   Envia arquivo ou marca OK sem arquivo
DELETE /api/processes/:id/checklist/:docId/files/:fileId  Remove arquivo
GET    /api/processes/:id/batch             Lista arquivos em lote
POST   /api/processes/:id/batch            Upload em lote
GET    /api/processes/:id/history          Histórico com cursor pagination
GET    /api/processes/:id/pdf/models       Lista modelos de PDF
POST   /api/processes/:id/pdf/models/:key/generate  Gera PDF
```

### `housing-complexes/` — Conjuntos Habitacionais

CRUD de conjuntos habitacionais MCMV. Endpoints de escrita requerem `role: admin`; endpoints de leitura para dropdowns requerem apenas autenticação.

### `dashboard/` — Estatísticas

Endpoint único `GET /api/dashboard/stats` que retorna KPIs agregados: total de processos, distribuição por status, por tipo de proprietário, criações por período, top usuários e top conjuntos.

### `admin/` — Administração

Funções exclusivas para `admin`:
- `GET/POST/PATCH /api/admin/users` — listar, criar e editar usuários
- `POST /api/admin/users/:userId/reset` — resetar conta e gerar senha temporária

### `system/` — Health Check

`GET /api/system/health` — retorna `{ ok: true }`. Utilizado pelo Docker e monitoramento.

## Banco de Dados

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `auth_user` | Usuários (gerenciado pelo better-auth) |
| `auth_session` | Sessões ativas |
| `process` | Processos jurídicos |
| `processDocument` | Itens do checklist documental de cada processo |
| `processDocumentFile` | Arquivos enviados para cada item do checklist |
| `processHistory` | Trilha de auditoria de todas as alterações (JSONB com campos alterados) |
| `housingComplex` | Conjuntos habitacionais MCMV |

### Schema do processo (`process`)

Campos relevantes além dos pessoais:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `status` | enum | Estado atual no fluxo processual |
| `cpf` | text | CPF normalizado (somente dígitos) |
| `legalProcessNumber` | text | Número do processo jurídico |
| `causeValue` | text | Valor da causa (formato `1.234,56`) |
| `protocolDate` | date | Data de protocolo (ISO: `YYYY-MM-DD`) |
| `finalizationData` | jsonb | Dados registrados na finalização |
| `cancelReason` | text | Motivo do cancelamento (opcional) |
| `witness1Id` / `witness2Id` | uuid | FK para `auth_user` |

### Migrations

```bash
# Gerar nova migration após alterar um schema.ts
bunx drizzle-kit generate

# Aplicar migrations pendentes
bun run db:migrate

# Interface visual do banco (Drizzle Studio)
bunx drizzle-kit studio
```

Migrations rodam automaticamente na inicialização da API via `bun run db:migrate`.

## Autenticação e Autorização

### Sessão

O better-auth gerencia sessões via cookies HTTP-only. O middleware `session.ts` extrai a sessão de cada requisição e injeta `user` e `session` no contexto Hono.

O navegador nunca deve depender da URL direta da API para autenticação:

- em desenvolvimento local, o Vite do frontend encaminha `'/api/*'` para a API real
- em produção/dev em nuvem, o CloudFront do frontend encaminha `'/api/*'` para o API Gateway

Esse desenho mantém a sessão como mesma origem do ponto de vista do browser e reduz bloqueios de cookie em ambientes mais restritivos.

### Guards

```typescript
import { requireAuth, requireRole, getAuthenticatedUser } from '@/shared/middleware/auth-guard'

// Apenas autenticado
requireAuth()

// Apenas roles específicas
requireRole('admin', 'attorney')

// Obter usuário atual dentro do handler
const user = getAuthenticatedUser(c)
```

## Erros

Todos os erros de serviço extendem `ServiceError`:

```typescript
// shared/errors/service-error.ts
export class ServiceError extends Error {
  constructor(
    message: string,
    public statusCode: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500 | 503
  ) { super(message) }
}

// modules/processes/processes.errors.ts
export class ProcessNotFoundError extends ServiceError {
  constructor() { super('Processo não encontrado', 404) }
}
```

O `handleServiceError()` intercepta `ServiceError` e retorna a resposta HTTP adequada. Erros não esperados retornam 500.

## Armazenamento de Arquivos

O MinIO armazena arquivos em buckets S3-compatible. As chaves de objeto são construídas via helpers em `shared/storage/s3.ts`:

| Helper | Exemplo de chave |
|--------|-----------------|
| `buildProcessDocumentObjectKey(processId, fileId)` | `processes/{processId}/documents/{fileId}` |
| `buildProcessBatchObjectKey(processId, fileId)` | `processes/{processId}/batch/{fileId}` |
| `buildProcessGeneratedDocumentObjectKey(processId, key)` | `processes/{processId}/generated/{key}` |

Downloads são gerados via URL pré-assinada com `createStorageObjectDownloadUrl()`.

## Comandos

```bash
bun run dev               # Dev server com watch (Bun)
bun run db:migrate        # Aplica migrations pendentes
bunx drizzle-kit generate # Gera nova migration a partir do schema
bunx drizzle-kit studio   # Abre Drizzle Studio no navegador
bun run typecheck         # Checagem TypeScript
bun run lint              # Biome lint
bun run format            # Biome format
```

## Como Contribuir

### Adicionando um novo módulo

1. Crie o diretório `src/modules/meu-modulo/`
2. Crie os arquivos seguindo o padrão:
   - `meu-modulo.schema.ts` — tabelas Drizzle
   - `meu-modulo.schemas.ts` — schemas Zod
   - `meu-modulo.service.ts` — lógica de negócio
   - `meu-modulo.errors.ts` — erros específicos
   - `meu-modulo.routes.ts` — endpoints Hono
3. Exporte o schema Drizzle em `shared/db/schema.ts`
4. Registre as rotas em `routes/index.ts`
5. Gere e aplique a migration:
   ```bash
   bunx drizzle-kit generate
   bun run db:migrate
   ```

### Adicionando um endpoint

1. Defina o schema Zod em `schemas.ts`
2. Escreva a função de serviço em `service.ts` — lance `ServiceError` para erros esperados
3. Adicione a rota em `routes.ts` usando os helpers de `shared/`
4. Nunca duplique lógica de auth, validação ou tratamento de erro

### Checklist antes do PR

- [ ] `bun run typecheck` passa sem erros
- [ ] `bun run lint` passa sem warnings
- [ ] Novos campos no schema têm migration gerada
- [ ] Erros lançam `ServiceError` com status code correto
- [ ] Rotas que alteram estado requerem pelo menos `requireAuth()`
