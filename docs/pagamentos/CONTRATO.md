# Módulo Pagamentos — contrato técnico (V3)

Fonte funcional: *Especificação funcional e lógica V3* (29/09/2026). Este documento
registra como o código a implementa e as **decisões técnicas** tomadas onde a V3 deixa
margem. Substitui o contrato do Stage 1 (cascata fixa e defaults 20%/4%/R$ 500,
removidos).

## 1. Princípio: motor fixo, dados configuráveis

O código conhece somente etapas, bases e operações. Recebedores, funções, percentuais,
valores fixos, vigências, condomínios, natureza e unicidade vêm de **regras
configuradas** (cadastro manual ou importação — mesma tabela, mesma gravação,
INV-10). Não existe nome ou percentual de negócio no código (INV-11/12). O sistema
nasce vazio; sem regra aplicável o cálculo **bloqueia**.

## 2. Etapas do motor (`pagamentos-motor-v3.0`)

| Etapa da regra | Letra | Base | Naturezas aceitas |
|---|---|---|---|
| `PROVISAO_RECEITA` | B | A (receita total) | provisão |
| `DEDUCAO_LIQUIDA` | E–H | C = A − B | crédito a recebedor ou provisão |
| `RESERVA` | I | valor fixo ou % de C | reserva (unicidade opcional por processo) |
| `PARTICIPACAO_RESULTADO` | L | J = C − D | crédito |
| `DISTRIBUICAO_FINAL` | N… | M = J − L | crédito, somente percentual |

`D = Σ(E–H) + Σ(I)`, `P = M − ΣN` e precisa ser **R$ 0,00**.

## 3. Unidades e centavos

- Dinheiro em centavos inteiros (`bigint`); multiplicações em `BigInt`.
- Percentual em pontos base (0,01%). **0 é válido; `NULL` = não configurado** (INV-04).
- Etapas B, E–H, I e L: arredondamento meio para cima por regra; resultados
  intermediários são diferenças (sem arredondamento).
- Distribuição final: truncamento de cada parcela e **centavos residuais pelo maior
  resto** (desempate: ordem configurada, linhagem, id). Registrado no passo da memória
  como "centavo residual". Garante `ΣN = M` e `P = 0` (INV-09). *Decisão técnica.*
- Web e API usam a mesma regra (teste de paridade no web).

## 4. Seleção de regras

- Vigência pela **data de cadastro do cliente** = `process.created_at` convertida para
  data civil em America/Sao_Paulo, gravada no recebimento (INV-02). Vale para todas as
  etapas; a data de liberação não seleciona regra.
- Condomínio: a regra precisa listar o condomínio do processo (N:N; sem "todos")
  (INV-03). Processo sem condomínio bloqueia.
- Ambiguidade: duas versões aplicáveis do mesmo contexto (etapa + recebedor/reserva +
  função) bloqueiam; o cadastro já recusa sobreposição de condomínio e vigência.
- **Etapas obrigatórias** (*decisão técnica* para "se a etapa exigir"): B e N. Sem
  regra nessas etapas, bloqueia; 0% explícito satisfaz.

## 5. Bloqueios (P03)

Códigos com causa e correção: `VALOR_INVALIDO`, `DATA_LIBERACAO_AUSENTE`,
`DATA_CADASTRO_AUSENTE`, `PROCESSO_SEM_CONDOMINIO`, `SEM_REGRA_APLICAVEL`,
`VIGENCIA_INCOMPATIVEL`, `CONDOMINIO_INCOMPATIVEL`, `ETAPA_OBRIGATORIA_SEM_REGRA`,
`PARAMETRO_NAO_CONFIGURADO`, `REGRA_AMBIGUA`, `REGRA_INVALIDA`,
`DISTRIBUICAO_FINAL_INCONSISTENTE`, `RESULTADO_NEGATIVO`, `MEMORIA_INCONSISTENTE`.

## 6. Estados

Recebimento (trigger no banco): `RASCUNHO → EM_PREVIA | BLOQUEADO`,
`BLOQUEADO → EM_PREVIA` (após correção), `EM_PREVIA → APTO` (aprovação só se o
hash da memória não mudou), `APTO → FECHADO`, `FECHADO → EM_PREVIA` apenas por estorno
do fechamento; `CANCELADO` antes do fechamento. Crédito: `ABERTO →
PARCIALMENTE_PAGO → PAGO`, `ESTORNADO` (mantido por trigger a partir das baixas e
ajustes).

## 7. Fechamento, crédito, baixa, ajuste, estorno

- Fechamento atômico e idempotente (chave + hash do pedido; requisições com a mesma
  chave serializam), revalida cada item contra o hash aprovado, congela memória,
  versões de regra e passos (linhas imutáveis por trigger), gera créditos (natureza
  crédito) e constitui reservas/provisões.
- Um recebimento não integra dois fechamentos ativos (índice único parcial).
- Baixa referencia o crédito; o trigger trava o crédito, recusa acumulado acima do
  devido (INV-06) e grava o saldo após a operação. Data efetiva não pode ser futura.
- Ajuste: evento com motivo que altera o devido (nunca abaixo do pago).
- Estornos preservam histórico: baixa e movimento de reserva mudam para `ESTORNADO`
  com motivo (sem DELETE); estorno de fechamento exige nenhuma baixa ativa e reserva
  não consumida.

## 8. Reservas e provisões

Reserva identificada pelo nome configurado na regra (chave normalizada). Constituição
só no fechamento; gasto efetivo e transferência só reduzem o saldo da reserva (nunca a
receita, CT-15). Saldo global e por processo nunca negativo (trigger serializado por
reserva). Reserva única por processo: índice único parcial + contexto de cálculo que
atribui a reserva ao primeiro recebimento em aberto do processo (liberação, criação, id).

## 9. Permissões

Grupo `financeiro`: `view`, `lancar`, `conferir`, `fechar`, `baixar`, `regras`,
`importar`, `reservas`, `estornar`, `exportar`. Negado por padrão a todos (inclusive
admin comum); MASTER tem tudo. Leitura filtrada pela visibilidade de processos;
configuração, importação, fechamento, baixa, reservas e estornos exigem escopo total.

## 10. Pendências de negócio (não técnicas)

1. Homologar percentuais e participantes reais (a V3 exige cenário real validado).
2. Multa e sucumbência usam as mesmas regras dos honorários (a V3 não diferencia).
3. Segregação lançar × aprovar (hoje a mesma pessoa pode, se tiver as duas flags).
4. Destino da provisão de apoio e do saldo de reservas (fase 2).
5. Perfis que recebem acesso financeiro.
