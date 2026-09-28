# Módulo Pagamentos — contrato técnico (v1, demonstrativo)

> Situação: **NÃO homologado** para movimentação de dinheiro real. A cascata de
> distribuição e várias regras abaixo são hipóteses de demonstração, marcadas com
> **[hipótese]**, até existir um caso real completo validado pelos responsáveis
> financeiros. Apenas dados fictícios.

## 1. Unidades e arredondamento

- Dinheiro: **centavos inteiros** (`bigint` no PostgreSQL, `number` inteiro seguro em
  TS; multiplicações feitas em `BigInt`). Nenhum cálculo monetário em ponto flutuante.
- Percentuais: **pontos base** (1 pb = 0,01%; 20% = 2000 pb).
- Arredondamento por rubrica: `meio para cima` (half-up) ao centavo:
  `round(valor × pb / 10000)`.
- Rubricas por **diferença** (receita líquida, base distribuível, saldo final da
  cascata) nunca são arredondadas: absorvem o resíduo. O resíduo de centavos vai
  sempre para o **saldo final da cascata** (determinístico).
- Versão do algoritmo gravada em cada cálculo/fechamento: `pagamentos-calc-v1`.

## 2. Fórmula por recebimento

```
bruto                   = valor recebido e elegível
tributo_provisionado    = round(bruto × 2000 pb)              (20%)
liquido                 = bruto − tributo_provisionado
participacao[i]         = round(liquido × pb_i)               (Wilamy, lideranças, prospectadores)
provisao_apoio          = round(liquido × 400 pb)             (4%, segregada, não distribuída)
reserva_certidao        = 500,00 se é o 1º recebimento elegível do processo, senão 0
base                    = liquido − Σ participacao − provisao_apoio − reserva_certidao
cascata (ordenada)      = passo k recebe round(saldo_k × pb_k); saldo_{k+1} = saldo_k − passo k
saldo_final             = saldo após o último passo percentual (recebe o resíduo)
```

**Invariante obrigatório** (verificado no motor e nos testes):
`tributo + Σ participações + provisão 4% + reserva certidão + Σ cascata + saldo final = bruto`.

Se `base < 0` o cálculo é **bloqueado** (alerta `BASE_NEGATIVA`): o recebimento não
pode ser conferido/fechado até correção das regras. Não se cria saldo inexistente.

## 3. Regras de participação (versionadas)

Cada regra: destinatário, papel, conjunto (ou todos), vigência inclusiva
`[validFrom, validTo]` (`validTo` nulo = aberta), pontos base, ordem (cascata).

| Papel | Semântica |
|---|---|
| `PARTICIPACAO` | % sobre o líquido (ex.: Wilamy) |
| `LIDERANCA` | % sobre o líquido |
| `PROSPECTADOR` | % sobre o líquido |
| `DISTRIBUICAO` | passo da cascata: % sobre o saldo corrente, por `ordem` |
| `DISTRIBUICAO_SALDO` | recebe o saldo final da cascata (exatamente 1 aplicável) |

- **Data de referência** das participações: data de cadastro do processo
  (`process.created_at` convertida para data civil em America/Sao_Paulo), gravada no
  recebimento. **[hipótese]** A cascata usa a **data de liberação** do recebimento.
- Processo em `RASCUNHO`, sem evento `CREATED` no histórico, ou com data informada
  manualmente → alerta `DATA_REFERENCIA_AMBIGUA` (não bloqueia; fica na memória).
- **Conflito** (impede publicação): mesma pessoa + mesmo papel de participação, ou
  mesma ordem de cascata, ou dois `DISTRIBUICAO_SALDO`, com escopos de conjunto que se
  sobrepõem (conjunto igual, ou um deles "todos") e vigências que se interceptam.
  Especificidade não resolve conflito: a sobreposição é tratada como ambígua.
- Regras publicadas são imutáveis; alteração = nova revisão (nova regra) + encerramento
  de vigência ou revogação da anterior, com motivo e auditoria.
- Cascata demonstrativa **[hipótese]**: Ivanildo 50% (quando aplicável), Wilomar 60%,
  Gean 40%, Inova saldo final. Modelada como dados (seed fictício), não código.

## 4. Reserva de certidão e provisões (livro de reservas)

Livro único `finance_reserve_movement` com `pool`:

| Pool | Escopo do saldo | Crédito | Débitos |
|---|---|---|---|
| `CERTIDAO` | processo | constituição no fechamento (1× por processo, índice único) | despesa real de cartório, transferência de saldo |
| `TRIBUTO` | fechamento | provisão de 20% no fechamento | despesa tributária efetiva, transferência da diferença |
| `APOIO` | global | provisão de 4% no fechamento | transferência (fase 2) |

- Débitos nunca levam o saldo abaixo de zero (bloqueio com trava transacional).
- Despesa/transferência posterior **não** reduz de novo a base distribuível.
- A reserva de certidão é constituída no fechamento que primeiro inclui um recebimento
  do processo; dentro do fechamento, cabe ao recebimento mais antigo
  (data de liberação, criação, id). Na prévia, aparece se o processo ainda não tem
  reserva constituída.

## 5. Estados

Recebimento: `PREVISTO → LIBERADO → CONFERIDO → FECHADO`; `CANCELADO` antes do
fechamento. Estorno de fechamento devolve os recebimentos para `CONFERIDO`.

Fechamento: `ATIVO | ESTORNADO`. Atômico (uma transação), idempotente (chave de
idempotência única), congela entradas, regras (cópia integral + revisão), versão do
algoritmo, hash das entradas e linhas calculadas (triggers impedem UPDATE/DELETE das
linhas). Índice único parcial impede um recebimento em dois fechamentos ativos.
Estorno exige motivo e é bloqueado se houver baixas ativas alocadas.

Baixa (pagamento feito FORA da plataforma): pessoa, valor, data, referência, prova,
chave de idempotência única. Alocada FIFO às linhas devidas (fechamento mais antigo
primeiro); não pode exceder o saldo; estorno com motivo. Fechamento ≠ pagamento.

## 6. Permissões

Grupo `financeiro` no perfil: `view`, `lancar`, `conferir`, `fechar`, `baixar`,
`regras`, `reservas`, `exportar`. **Negado por padrão** a todos os perfis, inclusive
admin comum (mesmo mecanismo de `titularCaixa`/`cadastros`); apenas MASTER
(`MASTER_ADMIN_CPFS`) tem tudo. Leitura filtrada pela visibilidade de processos do
usuário (escopo de conjunto). Operações globais (fechar, baixar, regras, reservas,
extrato por pessoa) exigem escopo `all` além da flag.

## 7. Datas

Datas civis (`date`) como `YYYY-MM-DD`, sem fuso. Agrupamento diário em
America/Sao_Paulo. Auditoria em `timestamptz` (UTC).

## 8. Pendências de negócio (não técnicas)

1. Homologar a cascata e seus percentuais com caso real completo.
2. Confirmar data de referência para rascunhos/importações e para a cascata.
3. Confirmar se multa/sucumbência seguem a mesma fórmula dos honorários contratuais
   (hoje: sim, todos elegíveis).
4. Definir se a conferência exige pessoa diferente do lançador (hoje: não exige).
5. Destino da provisão de 4% (fase 2).
6. Quem recebe acesso financeiro (hoje: somente MASTER até concessão explícita).
