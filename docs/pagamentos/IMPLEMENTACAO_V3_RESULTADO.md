# Pagamentos V3 — resultado da implementação (29/09/2026)

**Status geral:** implementado e testado localmente (API, banco, web e navegador),
publicado como Preview na Vercel com o runtime ok. O Preview ainda **não** fica
funcional com banco e login porque as variáveis do projeto Vercel existem apenas no
escopo Production, e a migration 0038 **não** foi aplicada ao banco demo. Nenhum
percentual ou nome de negócio está homologado: o sistema nasce vazio e tudo vem da
configuração.

| Item | Valor |
|---|---|
| Branch | `feat/pagamentos-v3` (remote pessoal `entrega`) |
| SHA base (`entrega/main` no início) | `382831ff240c07a7d4a245abe7716083e7d9d045` |
| Commits | `ab03448` backend/motor/0038 · `4a71654` telas · `1ece198` testes de comprovante · commit de documentação |
| Migrations criadas | `0038_finance_v3_engine` (0037 intocada; append-only) |
| Preview | `https://jurisflow-pagamentos-iva5bnlk8-icewelders-projects.vercel.app` (protegido por Vercel Authentication) |

## Arquivos principais

- API: `api/src/modules/finance/` — `finance.engine.ts` (motor puro), `finance.money.ts`,
  `finance.schema.ts`, `finance.config.service.ts`, `finance.import.service.ts`,
  `finance.receipts.service.ts`, `finance.closings.service.ts`,
  `finance.reports.service.ts`, `finance.attachments.service.ts`,
  `finance.support.ts`, `finance.schemas.ts`, `finance.routes.ts`; permissões em
  `api/src/modules/permissions/*`; migration `api/drizzle/0038_finance_v3_engine.sql`;
  scripts `test-finance-integration.ts` e `verify-0038-guard.ts`.
- Web: `web/src/features/finance/` (service/queries/mutations, páginas, componentes),
  rotas `web/src/routes/_protected/pagamentos*.tsx`, item de menu no shell.

## Schema (0038)

`finance_rule` (versão por linha, `lineage_id` + `version`, etapa, natureza, valor
percentual/fixo com `NULL` = não configurado), `finance_rule_housing_complex`,
`finance_import_batch`, `finance_receipt` (estados V3, memória e hashes),
`finance_closing`, `finance_closing_item`, `finance_closing_line` (passos da memória),
`finance_credit`, `finance_payout`, `finance_adjustment`, `finance_reserve_movement`,
`finance_attachment`; `finance_recipient` e `finance_audit_log` mantidas. 19 triggers
(estados, imutabilidade, INV-06, saldo de reserva). A 0038 aborta se as tabelas da 0037
tiverem qualquer linha — provado por `bun run scripts/verify-0038-guard.ts`.

## Endpoints (`/api/finance`)

`GET overview` · `GET|POST recipients`, `PATCH recipients/:id` · `GET|POST rules`,
`POST rules/:id/versions`, `POST rules/:id/revoke` · `POST imports/preview|confirm` ·
`GET processes`, `GET housing-complexes` · `GET|POST receipts`, `GET|PATCH
receipts/:id`, `POST receipts/:id/calculate|approve|cancel` · `GET closings`, `POST
closings/preview`, `POST closings`, `GET closings/:id`, `POST closings/:id/reverse` ·
`GET credits` · `GET|POST payouts`, `POST payouts/:id/reverse` · `POST adjustments` ·
`GET statement`, `GET statement.csv` · `GET reserves`, `GET|POST reserves/movements`,
`POST reserves/movements/:id/reverse` · `GET|POST attachments/:ownerKind/:ownerId`,
`GET attachment-files/:id`.

## Telas e rotas

`/pagamentos` (visão geral e estado vazio), `/pagamentos/configuracao` (P04),
`/configuracao/novo` (P04B), `/configuracao/importar` (P04C),
`/recebimentos`, `/recebimentos/novo` (P01), `/recebimentos/:id` (P02, P03, P09,
comprovantes, histórico), `/fechamentos` (P06), `/fechamentos/:id` (créditos, P07,
ajuste, estornos), `/extratos` (P08 + CSV), `/reservas` (P10). Bloqueios aparecem
no detalhe do recebimento (em vez de rota separada). P00/P05/P11/P12 não viraram telas
(são de homologação).

## Casos de teste V3

Unitários do motor: `api/src/modules/finance/finance.engine.test.ts`. Integração:
`finance.flow.integration.test.ts` em PostgreSQL recriado. "Navegador" = teste manual
no `localhost` com dados fictícios.

| CT | Resultado | Evidência |
|---|---|---|
| CT-01 sistema vazio | PASS | integração + navegador (R$ 0,00, ações de cadastro/importação) |
| CT-02 cadastro manual | PASS | integração (9 regras v1) + navegador (colaborador, provisão e distribuição) |
| CT-03 importação equivalente | PASS | integração: CSV → prévia sem gravação → confirmação idempotente; passos e fórmulas idênticos ao manual. Tela de importação construída, sem upload manual no navegador |
| CT-04 fluxo normal | PASS | integração (baixa total → saldo zero) + navegador (fechamento FEC-000001) |
| CT-05 sem regra | PASS | integração + navegador (BLOQUEADO com causa) |
| CT-06 0% explícito | PASS | unitário + integração |
| CT-07 parâmetro ausente | PASS | unitário + integração + navegador (etapa obrigatória) |
| CT-08 segundo recebimento | PASS | unitário + integração (inclusive índice único no banco) |
| CT-09 baixa parcial | PASS | integração + navegador (PARCIALMENTE PAGO, saldo R$ 5.600,00) |
| CT-10 baixa acima do saldo | PASS | integração (422 e concorrência: só uma de duas passa) |
| CT-11 nova versão | PASS | integração (fechamento antigo mantém v1/3%; novo cliente usa v2/3,5%) |
| CT-12 múltiplos recebedores | PASS | integração (3 participantes na mesma etapa) |
| CT-13 condomínio fora do escopo | PASS | unitário + integração |
| CT-14 arredondamento | PASS | unitário (R$ 3,33 calculado à mão; 3.000 valores) + integração (R$ 12.345,67) |
| CT-15 gasto de reserva | PASS | integração (500 → 320 → 220; 220,01 recusado; receita inalterada) + navegador |
| CT-16 estorno | PASS | integração (histórico BAIXA + ESTORNO_BAIXA; DELETE recusado) |
| CT-17 consulta por data | PASS | integração (pago no dia) + CSV |
| CT-18 rastreabilidade | PASS | integração (extrato → crédito → linha → fechamento → regra/versão → recebimento → processo) + links na UI |

TEST-001 (V3 §21) reproduzido exatamente: B 2.400,00; E 288,00/192,00/384,00/240,00;
I 500,00; D 1.604,00; J 7.996,00; L 3.998,00; N 1.599,20/2.398,80; P 0,00.

## Gates

| Gate | Resultado | Comando |
|---|---|---|
| Journal de migrations | 39 válidas | `cd api; bun run db:check` |
| Migration do zero em `_test` | 39 aplicadas | `bun run test:integration:finance` |
| Guarda da 0038 | aborta com dados, preserva a linha | `bun run scripts/verify-0038-guard.ts` |
| API typecheck / lint | ok / ok | `bun run typecheck; bun run lint` |
| API unit | 123 pass, 38 skip (integrações puladas sem flag), 0 fail | `bun test` |
| API integração financeira | 50 pass, 0 fail (31 motor + 19 fluxo) | `bun run test:integration:finance` |
| Build API (entrada Vercel, Node ESM) | ok: health 200, bootstrap 200, rota financeira 401 | `bun build server.ts --target=node` + `node` |
| Web typecheck / lint / test | ok / ok / 50 pass | `cd web; bun run typecheck; bun run lint; bun run test` |
| Web build | ok (aviso de chunk preexistente) | `bun run build` |
| E2E | Sem Playwright no projeto; não introduzido. Fluxo completo validado manualmente no navegador (acima) | — |
| Vercel Preview | build Ready; `health` 200 no commit `1ece198`; SPA 200; `bootstrap-check` 503 por falta de variáveis no escopo Preview | `vercel curl` |
| Produção | intacta (`382831f`, health e banco 200) | — |
| Banco demo | 0038 **não aplicada** | — |

## Limitações reais

1. **Preview sem variáveis**: `DATABASE_URL` e `BETTER_AUTH_SECRET` estão só em
   Production. Configurar o escopo Preview é ação do dono do projeto Vercel.
2. **Banco demo**: aplicar a 0038 requer as credenciais do Supabase demo; não foi feito.
   É aditiva para o código em produção (nenhuma rota de `main` usa as tabelas
   financeiras) e aborta se houver dados.
3. **Comprovantes na Vercel**: não há S3 configurado; a API responde 503 explícito.
   Localmente testado com SeaweedFS.
4. Exportação PDF não implementada (CSV sim).
5. Figma consultado parcialmente pelo visualizador público (sem integração Figma).
6. Nenhuma regra real homologada; percentuais de teste existem apenas em testes.
