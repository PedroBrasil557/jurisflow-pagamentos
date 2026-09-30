# Gap arquitetural — Contas a Receber e Conciliação

## Problema

O fluxo aprovado prevê:

**Processo → Conta a Receber → Entrada do Dinheiro → Conciliação → Recebimento confirmado → Regras/Rateio**.

Hoje o sistema parte de `Processo → financeReceipt`, portanto falta a expectativa financeira anterior à entrada.

## Requisitos mínimos da próxima implementação

### Conta a Receber

- vinculada a `process.id` e `housingComplexId`;
- valor `FIXO` ou `VARIAVEL`;
- valor previsto opcional quando variável;
- tipo/natureza financeira;
- status derivado/consistente;
- totais: previsto, recebido, saldo;
- histórico/auditoria;
- não usar valor da causa como valor financeiro.

### Entrada do Dinheiro

Entidade própria para representar a transação recebida:

- valor;
- data;
- referência;
- pagador;
- usuário/data de registro;
- estado de conciliação.

### Alocação / Conciliação

- uma entrada pode ser alocada em uma ou várias contas/processos;
- soma das alocações não pode exceder a entrada;
- valor alocado atualiza o recebido/saldo da Conta a Receber;
- alocação precisa manter rastreabilidade;
- correção/estorno não apaga histórico.

### Integração com o motor atual

O motor atual deve continuar recebendo valores já conciliados por processo.

A nova camada não substitui regras, cálculo, fechamento, créditos, baixas ou reservas; ela entra antes deles.

## Critérios de aceitação

1. Criar Conta a Receber fixa de R$ 10.000,00 e exibir Previsto R$ 10.000,00 / Recebido R$ 0,00 / Saldo R$ 10.000,00.
2. Criar Conta a Receber variável sem valor definitivo sem inventar R$ 0,00 como previsão real.
3. Registrar entrada de R$ 4.000,00 e alocar integralmente a uma conta: recebido R$ 4.000,00 / saldo R$ 6.000,00.
4. Registrar nova entrada e permitir baixa parcial do saldo previsto.
5. Permitir uma entrada dividida entre dois processos, com soma das alocações igual ao valor conciliado.
6. Bloquear alocação acima do valor disponível da entrada.
7. Manter referência ao processo, cliente e condomínio em toda a cadeia.
8. Gerar recebimentos financeiros por processo somente a partir das alocações confirmadas, preservando compatibilidade com o motor A–P.
9. Extrato do processo deve apresentar Previsto, Recebido, Distribuído, Pago e Saldo.
10. Estorno/correção deve gerar histórico compensatório, nunca apagar a origem.

## Fora desta PR visual

Este gap exige migration, schema, API, serviços, telas e testes próprios. Deve ser entregue em PR funcional isolada.