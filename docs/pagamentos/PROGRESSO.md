# Módulo Pagamentos — checkpoint de progresso

Branch local `feat/pagamentos-local` (base `bac53ab`, origin/main), espelhada no
repositório **privado** `PedroBrasil557/jurisflow-pagamentos` após autorização
empresarial informada pelo responsável. A entrega funcional continua LOCAL; não houve
PR, merge ou deploy na ICSF. Contrato técnico: [CONTRATO.md](CONTRATO.md).
Refinamento: [REFINAMENTO_2026-09-28.md](REFINAMENTO_2026-09-28.md).
Etapa 2: [ETAPA_2_2026-09-29.md](ETAPA_2_2026-09-29.md).

## Estado em 29/09 (terça) — V3 implementada

Branch `feat/pagamentos-v3` a partir de `entrega/main` (`382831f`), publicada só no
remote pessoal `entrega`. Motor V3 parametrizado (sem defaults de negócio), migration
0038, API completa, telas em `/pagamentos`, CT-01..CT-18 aprovados. Detalhes e
evidências: [IMPLEMENTACAO_V3_RESULTADO.md](IMPLEMENTACAO_V3_RESULTADO.md); infra:
[ESTADO_ATUAL_INFRA_2026-09-29.md](ESTADO_ATUAL_INFRA_2026-09-29.md); gap:
[IMPLEMENTACAO_V3_GAP.md](IMPLEMENTACAO_V3_GAP.md). O conteúdo abaixo sobre o Stage 1
(cascata fixa, 20%/4%/R$ 500) foi **substituído** pela V3.

Comandos (PowerShell, em `api/`): `bun run db:check`, `bun test`,
`bun run test:integration:finance` (recria `app_pagamentos_test`),
`bun run scripts/verify-0038-guard.ts`, `bun run lint`, `bun run typecheck`.
Em `web/`: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.

Banco `app` local: 39 migrations; perfil "Financeiro — demo local" atribuído ao admin
fictício do seed apenas neste banco local, para testes no navegador.

Próxima ação: dono do projeto Vercel configurar variáveis no escopo Preview (ou
promover após revisão), aplicar 0038 no banco demo e configurar S3 privado.

## Estado em 28/09 (segunda) — etapa concluída (Stage 1, superado pela V3)

- Motor puro de cálculo `api/src/modules/finance/finance.engine.ts` (+ `finance.money.ts`):
  centavos inteiros, pontos base, arredondamento meio-para-cima por rubrica, resíduo no
  saldo final, reserva única de certidão, cascata configurável, detecção de conflitos,
  livro de reservas, alocação FIFO de baixas, memória de cálculo em pt-BR.
- Schema `finance.schema.ts` + migration `api/drizzle/0037_finance_payments.sql`
  (escrita a partir de `drizzle-kit export` + triggers; journal idx 37). 11 tabelas
  `finance_*`, FKs `RESTRICT`, índices únicos parciais, 11 triggers de imutabilidade e
  de saldo.
- Permissão `financeiro` (8 flags) negada por padrão a todos, inclusive admin comum;
  só MASTER tem tudo. Editor de perfis no web exibe o grupo.
- `deleteProcess` recusa processo com lançamento financeiro (antes de apagar storage).

## Comandos (PowerShell, a partir de `api/`)

```powershell
bun run db:check                  # journal de migrations
bun test                          # unitários (integração pulada)
bun run test:integration:finance  # cria/migra app_pagamentos_test e roda integração
bun run lint; bun run typecheck
```

Web (`web/`): `bun run lint; bun run typecheck; bun run test; bun run build`.

O script de integração recusa bancos cujo nome não termine em `_test`.

## Resultados registrados (28/09)

| Gate | Resultado |
|---|---|
| `db:check` | 38 entradas válidas |
| API `bun test` | 123 pass, 26 skip, 0 fail |
| `test:integration:finance` (PostgreSQL 18 real, `app_pagamentos_test`) | 38 pass (31 motor + 7 banco) |
| API lint / typecheck | ok / ok |
| Web lint / typecheck / test / build | ok / ok / 46 pass / ok (aviso de chunk preexistente) |

Banco `app` (seed) **não** recebeu a migration 0037 ainda.

## Não feito / bloqueios

- Armazenamento S3 local: não configurado (MinIO falhou no pull). Uploads/comprovantes
  **não testados**.
- Serviços, rotas e telas: ainda não iniciados.
- Regras de negócio não homologadas: ver seção 8 do contrato.

## Observações do ambiente

- O checkout usa CRLF; `biome format --write` converte para LF. Após formatar, restaurar
  arquivos cujo diff é só fim de linha (`git diff --ignore-cr-at-eol`).
- `web/src/routeTree.gen.ts` difere só em fim de linha (não commitar).
- CLAUDE.md cita `cadastro.tsx` (não existe) e ferramentas ruflo (indisponíveis nesta sessão).

## Próxima ação (terça 29/09)

1. `finance.access.ts` (flags + escopo `all` para operações globais; filtro de
   visibilidade de processos para leitura).
2. Serviços + rotas Hono: destinatários, regras (rascunho → publicar com trava e
   conflito), recebimentos (idempotência, estados, auditoria), prévia.
3. Storage S3 local (alternativa ao MinIO do compose) e comprovantes privados.
4. Aplicar 0037 ao banco `app` e seed fictício de destinatários/regras demonstrativas.
5. Encerrar a etapa 2 após prova do backend com dados fictícios; iniciar telas na etapa 3,
   conforme escopo e critérios do documento vinculado acima.

## Espelho privado criado em 28/09

- `main`: `bac53ab4b05362751ccb7270f09ef0aaaf703552`.
- Primeiro commit de Pagamentos: `9ce77b8f0d708b478f39822697743fe016f47924`.
- Documentos desta revisão foram adicionados à branch pessoal depois do primeiro push.
  No Windows, antes de continuar com o Claude: `git pull --ff-only entrega feat/pagamentos-local`,
  depois `git status --short --branch` e `git rev-parse HEAD`.
- O `origin` do Windows permanece ICSF; publicar somente no remoto `entrega` até
  o mantenedor definir a integração. Nenhum ambiente real foi migrado.
