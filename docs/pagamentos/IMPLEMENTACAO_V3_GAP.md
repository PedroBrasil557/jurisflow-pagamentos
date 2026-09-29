# Pagamentos V3 — análise de GAP do Stage 1

Fonte funcional: *JurisFlow — Módulo de Pagamentos, Especificação funcional e lógica*,
v3.0 (29/09/2026). Base de código: `entrega/main` `382831f`.

| Tema V3 | Stage 1 (0037) | Situação | Ação na V3 |
|---|---|---|---|
| Sistema começa vazio (§3, CT-01) | `DEFAULT_FINANCE_CONFIG` com 20%, 4% e R$ 500 no motor | **Divergente** | Remover defaults; toda etapa vem de regra configurada |
| Motor por etapas A–P (§20) | Tributo/apoio/certidão fixos + cascata "percentual sobre o saldo" | **Divergente** | Novo motor: B sobre A, deduções sobre C, reserva I, L sobre J, distribuição final sobre M, P = 0 |
| Fórmula independe de nome (INV-11) | Papéis `PARTICIPACAO/LIDERANCA/PROSPECTADOR/DISTRIBUICAO` | Parcial | Regra genérica: etapa + natureza + recebedor/reserva + função livre |
| 0% ≠ ausente (INV-04, CT-06/07) | CHECK `basis_points BETWEEN 1 AND 10000` | **Divergente** | 0038: `0..10000`, valor nulo = "não configurado" → bloqueio |
| Vigência pela data de cadastro do cliente (INV-02) | Participações sim; cascata pela data de liberação | Parcial | Todas as regras pela data de cadastro do processo/cliente |
| Condomínios vinculados (INV-03) | Um conjunto ou "todos" | Parcial | N:N `finance_rule_housing_complex`, lista explícita |
| Versionamento (§7, CT-11) | `revision` + `supersedes` sem fluxo | Parcial | Nova versão encerra a vigência da anterior; fechamentos guardam snapshot |
| Importação equivalente (§10, CT-03, INV-10) | Ausente | Ausente | Parser CSV/XLSX → prévia sem gravação → confirmação idempotente na mesma estrutura |
| Recebimento RASCUNHO/EM_PRÉVIA/APTO/BLOQUEADO (§23) | PREVISTO/LIBERADO/CONFERIDO | **Divergente** | Novo enum de estados (tabela vazia) |
| Memória de cálculo (§12) | Texto de memória no motor | Parcial | Passos estruturados (etapa, base, fórmula, arredondamento, versão) persistidos |
| Bloqueio com causa (§13) | Alertas bloqueantes | Parcial | Códigos + causa + correção sugerida; estado BLOQUEADO persistido |
| Fechamento imutável/idempotente (INV-07) | Tabelas + triggers, sem serviço | Parcial | Serviço transacional com chave de idempotência |
| Créditos (§15) | Linhas de fechamento, sem entidade crédito | Ausente | `finance_credit` com estado ABERTO/PARCIALMENTE_PAGO/PAGO/ESTORNADO |
| Baixa por crédito (§16, INV-06) | Baixa por pessoa com alocação FIFO | Divergente | Baixa referencia o crédito; trigger impede acumulado > devido; saldo após gravado |
| Ajuste/estorno (§23, INV-08) | Estorno de baixa/fechamento só no schema | Parcial | Serviço de estorno + `finance_adjustment` |
| Extrato (§17, CT-17/18) | Ausente | Ausente | Extrato por recebedor/período/condomínio/processo + CSV, com rastreio até a regra |
| Reservas/provisões (§19, CT-15) | Livro com pools fixos (CERTIDAO/TRIBUTO/APOIO) | Parcial | Pool configurável pela regra; unicidade por processo configurável; saldo nunca negativo |
| Permissões (prompt §47) | 8 flags | Parcial | + `importar`, `estornar` |
| Auditoria (§25) | Tabela `finance_audit_log` imutável, sem uso | Parcial | Gravar em toda mutação |
| Comprovantes | Tabela sem serviço; S3 local não testado | Parcial | Upload/download privados via API; 503 explícito sem storage |
| Frontend | Só editor de permissões | Ausente | `/pagamentos/*` no shell atual |
| E2E | Sem Playwright no projeto | Ausente | Não introduzir infraestrutura nova; testes de integração HTTP cobrem o fluxo |

## Estratégia de migração

Migrations são append-only: `0037` permanece intacta. A `0038` reestrutura as tabelas
financeiras **somente se estiverem vazias** — cada bloco começa com uma verificação que
aborta a migration caso exista qualquer linha, garantindo que nenhum dado seja perdido
(demo e `app` local não têm dados financeiros; o banco `_test` é recriado).
