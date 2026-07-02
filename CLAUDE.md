# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

JurisFlow is a legal process management platform for Brazilian housing (MCMV) regularization. It handles process creation, document management, PDF generation, and workflow tracking. All UI text is in Portuguese (pt-BR).

## Repository Structure

```
jurisflow/
├── api/                    # Backend (Hono + Drizzle + PostgreSQL)
├── web/                    # Frontend (React 19 + TanStack Start + shadcn/ui)
├── compose.yml             # Docker Compose (DB, MinIO, API, Web)
└── CLAUDE.md               # This file
```

## Tech Stack

### API
- **Runtime**: Bun
- **Framework**: Hono (type-safe routes with Zod validation)
- **ORM**: Drizzle ORM with PostgreSQL
- **Auth**: better-auth (session-based, cookie auth)
- **Storage**: MinIO (S3-compatible) for file uploads
- **PDF**: pdf-lib for document generation

### Web
- **Framework**: React 19 + TanStack Start (SSR)
- **Router**: TanStack Router (file-based routes)
- **Data Fetching**: TanStack React Query (client-side)
- **UI**: shadcn/ui + Tailwind CSS 4 + Radix UI
- **Forms**: react-hook-form + Zod
- **Icons**: lucide-react
- **Theme**: next-themes (light/dark)
- **Toast**: Sonner
- **Lint/Format**: Biome

## Commands

### API (`api/`)
```bash
bun run dev               # Start dev server (Bun watch)
bun run db:migrate        # Run Drizzle migrations
bunx drizzle-kit generate # Generate new migration
bunx drizzle-kit studio   # Open Drizzle Studio
bun run typecheck         # TypeScript check
bun run lint              # Biome lint
bun run format            # Biome format
```

### Web (`web/`)
```bash
bun run dev               # Start Vite dev server
bun run build             # Production build
bun run typecheck         # TypeScript check
bun run lint              # Biome lint
bun run format            # Biome format
```

### Docker
```bash
docker compose up -d      # Start all services
docker compose down       # Stop (keeps data - DO NOT use -v flag)
```

Services: API `:3556`, Web `:3555`, DB `:3557`, MinIO `:3558`, MinIO Console `:3559`

## Architecture

### API Shared Utilities (`api/src/shared/`)

```
shared/
├── errors/service-error.ts     # Base ServiceError class (all modules extend this)
├── validation/validators.ts    # jsonValidator, queryValidator, paramsValidator, getValidationErrorMessage
├── middleware/
│   ├── auth-guard.ts           # requireAuth(), requireRole(...), getAuthenticatedUser()
│   ├── error-handler.ts        # handleServiceError() — centralized error response
│   ├── logger.ts               # requestLogger() — logs method, path, status, duration, userId
│   ├── cors.ts                 # CORS middleware
│   └── session.ts              # better-auth session middleware
├── config/env.ts               # Environment config with Zod validation
├── db/                         # Drizzle database connection
├── storage/                    # MinIO client
├── types/app.ts                # Hono AppBindings type
└── utils/cpf.ts                # CPF validation/normalization
```

All modules use shared utilities. No duplicate validators, error handlers, or auth checks.

### API Route Pattern

```
Route (Hono) → shared validators → shared auth middleware → Service function → Drizzle query → JSON response
```

- Routes: `api/src/modules/*/routes.ts` — thin, only orchestration
- Services: `api/src/modules/*/service.ts` — business logic, throws ServiceError
- Schemas: `api/src/modules/*/schemas.ts` — Zod validation schemas
- DB Schema: `api/src/modules/*/schema.ts` — Drizzle table definitions
- Error classes extend `ServiceError`: `ProcessServiceError`, `AuthUserManagementError`

### Web Data Flow Pattern

```
Service (API call) → Query factory (queryOptions) → Component (useQuery/useMutation)
```

**Three file pattern per feature:**
- `*.service.ts` — Pure API calls using `apiClient` (Hono RPC, client-side)
- `*.queries.ts` — `queryOptions`/`infiniteQueryOptions` factories with hierarchical key structure
- `*.mutations.ts` — `useMutation` hooks with automatic query invalidation

**Global error handling:**
- `ErrorBoundary` wraps the entire app in `__root.tsx`
- `MutationCache.onError` shows toast automatically for any failed mutation
- `QueryError` component for individual query error states

**Never:**
- Call services directly from components — use query/mutation hooks
- Use `useState` for server data — use React Query
- Use `createServerFn` for data fetching — only for auth/session
- Duplicate utility functions — extract to `shared/`

### Auth Pattern

Auth runs **server-side only** via `createServerFn` in `_protected.tsx`:
- `getSession()` validates HTTP-only session cookie on the server
- `shouldReload: false` — session check runs once per browser session, not on every navigation
- Route context provides `{ session, user }` to all protected pages
- `apiServerClient` is used ONLY by auth session — all data fetching uses client-side `apiClient`

### Route Structure

```
web/src/routes/
├── __root.tsx              # Root layout (QueryClient, ThemeProvider, ErrorBoundary, Toaster)
├── login.tsx               # Public
├── cadastro.tsx            # Public
├── _protected.tsx          # Auth guard (getSession, shouldReload: false)
└── _protected/
    ├── index.tsx           # Dashboard
    ├── processos.tsx       # Processos layout
    ├── processos.index.tsx # List
    ├── processos.novo.tsx  # Create
    ├── processos.$processId.editar.tsx    # Edit
    ├── processos.$processId.checklist.tsx # Checklist
    ├── cadastros.tsx       # Admin registers
    └── primeiro-acesso.tsx # First access password change
```

Routes pass minimal props (URL params/search only). Pages fetch their own data via `useQuery`.

## Process Workflow

```
RASCUNHO → CADASTRADO → EM_DOCUMENTACAO → DOCUMENTACAO_PRONTA → EM_PROCESSO → FINALIZADO
    ↓           ↓              ↓                   ↓                 ↓
 CANCELADO   CANCELADO     CANCELADO           CANCELADO         CANCELADO
```

Authoritative source: [api/src/modules/processes/processes.status.ts](api/src/modules/processes/processes.status.ts) (`processStatuses` + `processStatusTransitions`). `EM_LOTE` is **retired** — kept in the enum only as a transition *origin* so legacy records can drain to `EM_DOCUMENTACAO`/`CADASTRADO`; it is no longer produced. `splitStatus` is a separate field (async job health), not a business phase.

| Status | Who | Actions |
|--------|-----|---------|
| RASCUNHO | Any user | Entry state of the digitization flow. Exits to CADASTRADO/EM_DOCUMENTACAO by completeness, or CANCELADO |
| CADASTRADO | Any user | Default status on creation. Move to EM_DOCUMENTACAO or cancel |
| EM_DOCUMENTACAO | Any user | Create, edit, upload docs. Auto-marks ready (DOCUMENTACAO_PRONTA) when all required docs complete |
| DOCUMENTACAO_PRONTA | Attorney/Admin | Start legal process (requires number, cause value, protocol date) |
| EM_PROCESSO | Attorney/Admin | Edit legal process data, finalize (requires legal fields filled), cancel |
| FINALIZADO | — | Terminal. Read-only. No edit/cancel |
| CANCELADO | — | Terminal. Read-only. No edit |

### Frontend Permission Rules
The `ProcessActions` dropdown hides options based on `userRole`:
- **Iniciar processo, Editar processo juridico, Finalizar**: only `attorney` and `admin`
- **Editar**: hidden for terminal statuses
- **Cancelar**: hidden for terminal statuses
- **Checklist, Gerar PDF, Historico**: always visible

## UI Component Patterns

### Shared Components (`web/src/shared/components/`)

| Component | Purpose |
|-----------|---------|
| `PageHeader` | Page title + description + eyebrow + action buttons |
| `SearchInput` | Input with search icon inside, full-width responsive |
| `StatusBadge` | Colored badge by tone (success/warning/info/error/ghost) |
| `AppDialog` | Standardized dialog with icon + variant + title + description |
| `SettingsLayout` | Mini sidebar + content for admin pages |
| `ErrorBoundary` | Global error catch with reload button |
| `QueryError` | Error state for failed queries with retry button |

### Feature Components (`web/src/features/processes/components/`)

| Component | Purpose |
|-----------|---------|
| `ProcessActions` | Dropdown menu with context-aware actions based on status + role |
| `ProcessStatusBadge` | Status badge with correct tone per process status |
| `ProcessMobileCard` | Mobile card layout for process list items |
| `ProcessLastMovement` | Last movement display with date formatting |
| `ProcessHistoryDialog` | Timeline with infinite scroll |
| `LegalProcessDialog` | Start/edit legal process with masked number input |
| `CancelProcessDialog` | Cancel confirmation with optional reason |
| `FinalizeProcessDialog` | Finalize confirmation |
| `GeneratePdfDialog` | PDF model selection with React Query |
| `ProcessFormSection` | Card wrapper for form sections |
| `ProcessFormField` | Form field wrapper (label + input + error + hint) |

### AppDialog Usage
Always use `AppDialog` instead of raw Dialog primitives:
```tsx
<AppDialog
  icon={Gavel}           // LucideIcon
  variant="info"         // default | info | success | warning | destructive
  title="Dialog title"
  description="Optional description"
  maxWidth="2xl"         // sm | md | lg | xl | 2xl | 3xl
  open={isOpen}
  onClose={() => setIsOpen(false)}
  footer={<Button>Action</Button>}  // Optional
>
  {children}
</AppDialog>
```

### Data Tables
`DataTable` shows cards on mobile (`xl:hidden`) and table on desktop (`xl:block`). Always wrap in:
```tsx
<Card className="overflow-hidden">
  <CardContent className="overflow-x-auto px-0 sm:px-0">
    <DataTable ... />
  </CardContent>
</Card>
```

## Naming Conventions

### Files
- Services: `feature-name.service.ts`
- Queries: `feature-name.queries.ts`
- Mutations: `feature-name.mutations.ts`
- Pages: `feature-name-page.tsx`
- Components: `component-name.tsx` in feature directories
- Schemas (API Zod): `feature-name.schemas.ts`
- Schema (API DB): `feature-name.schema.ts`

### Code
- Query keys: `featureKeys.all`, `featureKeys.lists()`, `featureKeys.list(query)`, `featureKeys.detail(id)`
- Mutations: `useCreateFeature()`, `useUpdateFeature()`, `useDeleteFeature()`
- Status tones: `success`, `warning`, `info`, `error`, `ghost`
- Error classes: extend `ServiceError` from `shared/errors/service-error.ts`
- Auth guards: use `requireAuth()`, `requireRole(...)`, `getAuthenticatedUser()` from shared
- Validators: use `jsonValidator()`, `queryValidator()`, `paramsValidator()` from shared

### Text Rules
- All text in sentence case (never UPPERCASE for labels, buttons, messages)
- No `.toUpperCase()` on user-facing text
- No `uppercase tracking-[*]` CSS classes on content text
- No `biome-ignore` comments — fix the issue instead

### Import Aliases
- `@/` = `src/` (path alias in web, for shared/features code)
- `#/` = `src/` (imports map in package.json, for shadcn components)
- `@api/` = API types (shared via Hono RPC type inference)

## Design Rules

- Buttons: shadcn `<Button>` with default size `h-9`
- Inputs: shadcn `<Input>` with height `h-9`
- Links as navigation: `<Link className="no-underline" preload={false}>`
- Links inside dropdowns: always `preload={false}`
- Status badges: `<StatusBadge tone="...">`
- Dialogs: `<AppDialog>` with `icon` and `variant`
- Form sections: `<ProcessFormSection title="...">` (wraps in Card)
- Sidebar: shadcn Sidebar with `collapsible="icon"` mode
- Tables: cards below `xl`, table above
- Primary color: blue (`oklch(0.45 0.2 264)` light, `oklch(0.6 0.18 264)` dark)

## Biome Config

- API: `biome.json` at `api/` root
- Web: `biome.json` at `web/` root — ignores `src/components/ui` (shadcn auto-generated)
- Both use: single quotes, no semicolons, space indent
- Run `bun run format` and `bun run lint` before committing

## Database Notes

- PostgreSQL volume mounted at `/var/lib/postgresql` (NOT `/var/lib/postgresql/data`)
- Migrations auto-run on API startup via `bun run db:migrate`
- Generate new migration: `bunx drizzle-kit generate`
- Legal process fields: `legalProcessNumber` (text), `causeValue` (text, regex validated), `protocolDate` (date, ISO format)
- Empty strings used for optional text fields (not NULL)
- Terminal states (FINALIZADO, CANCELADO) block edits via `assertProcessCanBeEdited()`
- All state changes create history entries for audit trail
- Finalization requires legal process fields to be filled

## Ruflo Workflow (persistent memory & guidance)

This project uses the **ruflo** MCP server for cross-session memory and guidance (ruflo tools are deferred — load schemas via ToolSearch first). The goal is **outcome quality, not tool coverage**: ruflo exposes ~250 tools, but for a focused legal-tech CRUD app only a handful add value. The rules below are **defaults that direct usage**, not a cage — escalate beyond them per-task when a task genuinely demands it.

**Always do (high-value, currently underused — these are firm triggers):**
1. **Task start** — `mcp__ruflo__memory_search` (namespace `jurisflow`) for prior decisions/patterns before re-deciding anything. This is mandatory on non-trivial tasks, not optional; recall beats re-deriving.
2. **After a key decision** (architecture, status model, data flow, naming, gotchas) — `mcp__ruflo__memory_store` (namespace `jurisflow`, `upsert: true`, with `tags`). One fact per entry.
3. **Don't re-litigate** what's already in memory — search first.
4. **Before a PR** — `analyze_diff` + `aidefence_has_pii` on the diff (CPF/process data → LGPD).

Seeded entries (namespace `jurisflow`): `arch/status-model`, `arch/scan-flow`, `ops/docker-windows-hmr`, `ruflo/usage-policy`. The process **status model** and the **"Escanear documentos" (scan) flow** live there — recall them instead of re-deriving.

**Namespaces** (the learning pipeline understands these): use `jurisflow` for project decisions, `patterns` for reusable code patterns (Hono route+Zod, web three-file pattern, AppDialog usage, status workflow), `tasks` for task outcomes, `feedback` for quality signals. On complex/multi-file features, also call `guidance_recommend` (and optionally `hooks_route`) at start.

**Default scope (default-with-escape, not a ban):** by **default** reach for ruflo's **memory + guidance + diff/PII** surface, and prefer **native Claude Code subagents (Plan/Explore)** for orchestration — they're simpler and deterministic. Hive-mind/consensus, ruflo swarms, and background workers (`audit`/`testgaps`) are **not the default** for routine work, but are **available**: escalate to them when task complexity justifies the extra cost/non-determinism, or when `guidance_recommend` surfaces a better-fit tool for that specific task. Discovery is always open via `ToolSearch`/`guidance_recommend` — the default never blocks reaching for a tool that genuinely fits.

**Versioning:** ruflo is a host dev tool (not a build/runtime dep — not in `package.json`), so a bug only affects dev ergonomics, not production. Policy: **stay current, don't hard-pin** — keep CLI **and** daemon on the same version (`npm install -g ruflo@latest`, then `ruflo doctor` to confirm "Version Freshness: up to date" and no CLI↔daemon skew). Only pin a known-good version if you hit a regression. (Current known-good: 3.10.37.)

Quick status-model reminder: `process.status` = business phase (RASCUNHO → CADASTRADO → EM_DOCUMENTACAO → DOCUMENTACAO_PRONTA → EM_PROCESSO → FINALIZADO/CANCELADO), driven by checklist completeness; `splitStatus` = async job health. **EM_LOTE is retired as a status** (kept in the enum only for history/legacy). The **"Em lote" tab** still exists as raw-PDF storage (≠ the status).
