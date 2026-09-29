# Estado atual da infraestrutura — 29/09/2026

Levantamento feito antes da implementação da V3 do módulo Pagamentos. Nenhum segredo
foi lido para este documento; variáveis aparecem **somente por nome**.

## Git

| Item | Valor |
|---|---|
| Remote pessoal autorizado | `entrega` → `PedroBrasil557/jurisflow-pagamentos` (único destino de push) |
| Remote corporativo | `origin` → `ICSF-Solutions/jurisflow` (somente leitura; nunca push/PR) |
| `entrega/main` no início | `382831ff240c07a7d4a245abe7716083e7d9d045` |
| `main` local | `bac53ab` rastreando `origin/main` (corporativo) — não usada como base |
| Branch anterior | `feat/pagamentos-local` = `entrega/feat/pagamentos-local` = `69f5069`, ancestral linear de `entrega/main` |
| Branch de trabalho | `feat/pagamentos-v3`, criada de `entrega/main` (`382831f`) |
| Working tree | limpo, exceto `web/src/routeTree.gen.ts` com diferença **apenas de fim de linha** (preservado, não commitado) |
| Branches remotas relevantes | `entrega/fix/*` e `entrega/chore/*` (correções Vercel já integradas em `entrega/main`) |

Commits de `entrega/main` desde minha sessão anterior (todos preservados): entrada Hono
para Vercel (`api/server.ts`), `vercel.json` com serviços, ESM na API
(`"type": "module"`), origem estável de produção para Better Auth, bypass do middleware
de sessão em `/api/auth/*` e health checks, `GET /api/system/health/db`, SPA fallback,
remoção dos endpoints temporários de diagnóstico.

## Stack encontrada

- **Web**: React 19 + Vite + TanStack Router (file-based, SPA — sem TanStack Start/SSR
  no build atual), TanStack Query, shadcn/ui + Tailwind 4, Biome, Vitest. **Sem Playwright.**
- **API**: Hono sobre Bun (local, `src/index.ts`) e Vercel Functions (Node, `server.ts`),
  Drizzle ORM + `pg`, Better Auth (cookie de sessão), Zod, `xlsx` (SheetJS), `jszip`,
  `pdf-lib`, AWS SDK S3.
- **Banco**: PostgreSQL 18 local (Docker, `:3557`, projeto `pagamentos-local`);
  Supabase PostgreSQL para a demo.
- **Storage**: abstração `api/src/shared/storage/s3.ts` (S3 compatível). Localmente há um
  SeaweedFS (`pagamentos-local-s3`, imagem `chrislusf/seaweedfs:4.40`, `weed mini`) em
  `:3558`. Na Vercel **não há variáveis S3** configuradas.

## Web

- Shell autenticado: `web/src/shared/components/authenticated-layout/*`; itens de menu
  em `authenticated-layout.navigation.ts` com `isVisible(permissions)`.
- Rotas: `web/src/routes/_protected/*.tsx`; guarda por permissão no `beforeLoad`.
- Dados: `*.service.ts` (Hono RPC `apiClient`, tipos inferidos de `@api/app`) →
  `*.queries.ts` → `*.mutations.ts`.

## API

- `api/src/routes/index.ts` monta módulos em `/api/*`; ordem: request-id, CORS, sessão
  (pula `/api/auth/*` e health), logger.
- `api/server.ts` (Vercel): bootstrap preguiçoso — health sem importar a aplicação,
  `bootstrap-check`, e import dinâmico do app no primeiro request. Não será simplificado.
- Health: `/api/system/health` (bootstrap, sem banco), `/api/system/health/db`.

## Autenticação e permissões

- Better Auth; `BETTER_AUTH_URL`/`WEB_URL` caem para `VERCEL_PROJECT_PRODUCTION_URL`
  (produção) ou `VERCEL_URL` (preview); `trustedOrigins` sem wildcard.
- Permissões por perfil (`permission_profile.permissions` JSON), resolvidas em
  `permissions.service.ts`. Grupo `financeiro` (Stage 1) negado por padrão, admin comum
  herda do perfil, MASTER (`MASTER_ADMIN_CPFS`) tem tudo. Escopo de processos:
  `own | housing_complex | all`.

## Vercel

- Projeto `icewelders-projects/jurisflow-pagamentos`, Git integration (deploy por push),
  produção em `https://jurisflow-pagamentos.vercel.app`.
- `vercel.json`: serviços `api` (root `api`, Hono, `server.ts`) e `web` (root `web`, Vite,
  rewrite SPA para `/index.html`); rota `/api/*` → api, restante → web.
- Variáveis (nomes): `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `ENVIRONMENT`,
  `DB_POOL_MAX`, `GEOIP_ENABLED`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_JWKS_URL` — **todas somente no escopo Production**.
- Código usa: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_URL`,
  `TRUSTED_ORIGINS`, `ENVIRONMENT`, `DB_POOL_MAX`, `GEOIP_ENABLED`, `MASTER_ADMIN_CPFS`,
  `S3_*`, `VERCEL*`. `SUPABASE_*` e `DIRECT_URL` não são lidos pelo código da API.

## Banco e migrations

- Drizzle, migrations em `api/drizzle/`, journal em `api/drizzle/meta/_journal.json`
  (snapshots só até 0027; 0028+ escritas à mão). Última: `0037_finance_payments`.
- Local `app`: 37 aplicadas (0037 **não** aplicada). `app_pagamentos_test`: 38.
- Demo Supabase: 38 aplicadas (inclui 0037), tabelas financeiras vazias, RLS ativo.
- `scripts/check-migrations.ts` valida idx e `when` crescente.

## Scripts

API: `dev`, `db:check`, `db:migrate`, `db:seed`, `lint`, `typecheck`, `test`,
`db:test:setup`, `test:integration:finance`. Web: `dev`, `build`, `test` (vitest),
`lint`, `typecheck`.

## Diferenças em relação à arquitetura local antiga

1. A API também roda como Vercel Function Node (ESM): nada de efeito colateral pesado
   no import, nada de filesystem persistente, nada de worker contínuo.
2. `localhost` não pode ser assumido fora do dev; URLs vêm de env/Vercel.
3. O fluxo de entrega passa por push no remote pessoal → Preview Vercel.
4. O web é servido como SPA (rewrite) — rotas profundas funcionam por fallback.

## Riscos encontrados

| Risco | Impacto | Tratamento |
|---|---|---|
| Variáveis só em Production | Preview de branch sobe sem `DATABASE_URL`/`BETTER_AUTH_SECRET` → API 503 | Documentar; configurar escopo Preview é decisão do dono do projeto Vercel |
| Preview e produção compartilhariam o mesmo banco demo | Migration de branch afeta a demo | 0038 é aditiva/guardada; só aplicar após testes locais |
| Sem S3 na Vercel | Comprovantes indisponíveis na demo | API responde 503 explícito; upload local testado com SeaweedFS |
| Stage 1 tem `DEFAULT_FINANCE_CONFIG` (20%/4%/R$ 500) e cascata por nome de papel | Viola V3 (INV-11/12, sistema vazio) | Remover na V3 |
| CHECK de `finance_rule` proíbe 0% | Viola INV-04 | Nova migration 0038 |
| Bancos `_test` acumulam dados indeléveis (imutabilidade) | Migrations com guarda de tabela vazia falham | Recriar o banco `_test` a cada execução de integração |
