# JurisFlow Pagamentos — Arquitetura do Fluxo Central V5

Data: 30/09/2026

## Fonte de verdade

Este documento alinha a implementação ao desenho aprovado **JurisFlow Pagamentos — Desenho das Partes Centrais** e às especificações funcionais V3.

O fluxo operacional é:

**Processo → Conta a Receber → Entrada do Dinheiro → Regras e Repartição → Pagamentos → Extratos e Controle**

O condomínio é agrupador/escopo de regras e consolidação; ele não é a conta financeira que recebe ou paga dinheiro.

## 1. Processo — origem do direito financeiro

- Condomínio agrupa pessoas/processos.
- Cada pessoa possui seu processo individual.
- O processo é a origem do direito financeiro.
- Não confundir valor da causa com honorário/valor financeiro do módulo.

## 2. Conta a Receber — expectativa antes da entrada

A Conta a Receber representa **o que se espera receber do processo** antes de o dinheiro efetivamente entrar.

Tipos aprovados:

- **Valor fixo** — exemplo: R$ 10.000,00.
- **Valor variável** — valor indefinido ou estimado.

A conta deve permitir acompanhar:

- Previsto;
- Recebido;
- Saldo.

Vínculos mínimos:

- `process.id`;
- `housingComplexId`;
- cliente herdado/identificado pelo processo;
- tipo/natureza;
- valor previsto quando conhecido;
- usuário e datas de registro.

### Gap atual

O V3 atual possui `processo → recebimento`, mas não possui ainda uma entidade própria de **Conta a Receber/expectativa financeira**. Este é o principal gap estrutural restante.

## 3. Entrada do Dinheiro — registro e conciliação

A entrada bancária representa o dinheiro que efetivamente chegou.

Dados de negócio previstos:

- valor;
- data;
- referência;
- pagador.

A conciliação deve:

- identificar o processo;
- permitir que uma entrada seja relacionada a **um ou vários processos** quando necessário;
- alocar o valor;
- atualizar o `Recebido` e o `Saldo` das Contas a Receber correspondentes.

O recebimento confirmado é o valor conciliado e ligado a processo(s).

### Gap atual

O `financeReceipt` atual pertence diretamente a um único processo. Ele atende bem ao recebimento já identificado, mas ainda não representa uma **entrada bancária independente com alocações múltiplas**. Não devemos simular essa arquitetura apenas renomeando `financeReceipt`.

## 4. Regras e Repartição

Depois que o valor foi confirmado/conciliado:

1. identificar regras por condomínio, tipo de receita, tipo de trabalho, vigência e prioridade;
2. executar o motor financeiro;
3. calcular provisões, reservas, participações e distribuição final;
4. gravar memória de cálculo com regra aplicada, fórmula/base e versão.

A implementação V3 já cobre este núcleo por regras versionadas + motor A–P + memória detalhada.

## 5. Fechamento e valores a pagar

Após conferência/aprovação:

- o fechamento congela os valores e versões;
- gera créditos por recebedor;
- cada crédito representa **quanto aquela pessoa/empresa tem direito a receber**.

A interface deve separar claramente:

- **Rateio** = como o dinheiro foi dividido;
- **Pagamento** = quanto cada recebedor tem direito, quanto já recebeu e quanto ainda falta.

## 6. Pagamentos e baixas

A aba **Pagamentos** é centrada no recebedor.

Para cada funcionário/recebedor mostrar:

- nome;
- função/trabalho;
- total devido;
- total pago;
- saldo a receber;
- origem por processo/cliente/condomínio;
- acesso ao rateio que gerou o crédito.

Pagamento ocorre fora do JurisFlow; o sistema registra a baixa.

Baixa pode ser:

- parcial;
- total;
- estornada com histórico preservado.

## 7. Extratos e Controle

Devem existir visões rastreáveis de:

### Extrato do Recebedor

- créditos;
- pagamentos;
- saldo.

### Extrato do Processo

- previsto;
- recebido;
- distribuído;
- pago;
- saldo.

### Extrato do Condomínio

- visão consolidada;
- múltiplos processos;
- resumo financeiro.

## 8. Reservas e provisões

Continuam como saldos separados:

- valor constituído;
- gasto efetivo;
- transferências;
- saldo.

Gastar uma reserva não deduz novamente a receita.

## 9. Camadas transversais

Continuam obrigatórias em todo o fluxo:

- Auditoria;
- Relatórios;
- Ajustes e estornos;
- Segurança e permissões;
- valores monetários em centavos;
- versionamento e imutabilidade após fechamento.

## 10. Navegação operacional

Enquanto Conta a Receber/Conciliação não estiver implementada de ponta a ponta, a navegação atual permanece sem uma aba falsa ou incompleta.

Estrutura funcional atual:

**Visão geral | Entradas | Rateios | Pagamentos | Reservas | Extrato | Configuração**

Destino arquitetural após implementar o gap:

**Visão geral | Contas a receber | Entradas | Rateios | Pagamentos | Reservas | Extrato | Configuração**

## 11. Estado de aderência

### Já aderente

- Processo como origem;
- recebimentos múltiplos por processo;
- regras/versionamento;
- cálculo e memória;
- validação APTO/BLOQUEADO;
- fechamento imutável;
- créditos por recebedor;
- tela de Pagamentos por recebedor;
- baixas parcial/total;
- reservas/provisões;
- extrato e auditoria.

### A implementar

- entidade Conta a Receber;
- valor fixo ou variável/estimado;
- Previsto / Recebido / Saldo por processo;
- entrada bancária separada do recebimento conciliado;
- conciliação e alocação para um ou vários processos;
- extrato do processo incluindo Previsto × Recebido × Distribuído × Pago × Saldo.

Esses itens devem entrar em uma PR própria porque alteram modelo de dados, API e regras de conciliação; não devem ser misturados à PR de simplificação visual da Visão geral.