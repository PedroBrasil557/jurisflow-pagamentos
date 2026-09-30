# JurisFlow Pagamentos — alinhamento com o Fluxo Central

Data: 30/09/2026

## Fonte de verdade funcional

Este alinhamento parte do desenho **Fluxo Central de Pagamentos JurisFlow** e das especificações funcionais/lógicas já aprovadas.

Fluxo central:

**Processo → Conta a Receber → Entrada do Dinheiro → Regras e Repartição → Pagamentos → Extratos e Controle**

O sistema deve manter separados:

1. origem do direito financeiro;
2. expectativa de recebimento;
3. dinheiro efetivamente recebido;
4. cálculo/repartição;
5. valores devidos aos recebedores;
6. pagamento efetivamente realizado;
7. extratos, reservas, saldos, ajustes, estornos e auditoria.

## Correspondência com o sistema atual

### 1. Processo — origem do direito

Já existe no domínio de Processos.

A organização conceitual é:

**Condomínio → Pessoa/cliente → Processo individual**.

O condomínio agrupa vários processos; o financeiro se ancora no processo individual.

### 2. Conta a Receber — expectativa

O desenho aprovado prevê:

- valor fixo ou variável;
- previsto;
- recebido;
- saldo a receber.

**Lacuna atual:** o V3 ainda não possui uma entidade própria de Conta a Receber. Hoje o fluxo começa no recebimento já registrado. Esta lacuna não deve ser mascarada usando `finance_receipt` como se fosse previsão, porque recebimento significa dinheiro que efetivamente entrou.

A implementação futura de Conta a Receber precisa definir, antes da migration, a cardinalidade exata por processo/tipo de receita e como uma transação pode liquidar uma ou várias contas.

### 3. Entrada do Dinheiro

Coberta atualmente por `finance_receipt` e pelas telas de Entradas.

Responsabilidade da etapa:

- valor;
- data;
- referência;
- origem/pagador;
- vínculo com processo;
- posterior conciliação.

**Lacuna estrutural:** a conciliação bancária 1:N/N:1 do fluxograma ainda não existe como entidade própria. A entrada atual já nasce vinculada diretamente a um processo.

### 4. Regras e Repartição

Coberta pelo motor financeiro V3.

Responsabilidade:

- identificar regras por condomínio, contexto, vigência e trabalho/função;
- calcular provisões, reservas, participações e distribuição final;
- gravar memória de cálculo;
- validar e bloquear inconsistências;
- congelar o resultado quando o rateio é finalizado.

Na UX, esta etapa passa a ser chamada simplesmente de **Rateios**.

### 5. Valores a pagar e Pagamentos

O fechamento técnico gera `finance_credit`, que representa **valor devido ao recebedor**. Na linguagem de negócio da interface, evitar usar “crédito” como conceito principal.

A aba **Pagamentos** deve responder, por recebedor:

- quanto tem direito a receber;
- quanto já foi pago;
- quanto ainda falta;
- de quais processos vieram os valores;
- qual função/trabalho originou o direito;
- acesso ao rateio de origem.

A baixa continua sendo o registro técnico do pagamento realizado fora do JurisFlow, mas a interface usa **Registrar pagamento** sempre que possível.

A tela operacional agrupa os valores por recebedor. Cada pessoa/empresa pode ser expandida para mostrar a origem por processo, cliente e condomínio, com devido, pago e saldo.

### 6. Extratos e Controle

Já existem extratos, reservas/provisões, ajustes, estornos e trilha auditável.

A visão esperada continua sendo:

- extrato do recebedor;
- extrato do processo;
- visão por condomínio;
- reservas/provisões com constituído, gasto, transferido e saldo.

## Alterações de UX deste alinhamento

1. Visão geral enxuta: apenas resumo e conciliação do dinheiro.
2. `Rateios e pagamentos` é separado em duas responsabilidades:
   - **Rateios** = conferência/finalização da repartição;
   - **Pagamentos** = visão por recebedor de devido, pago e saldo.
3. Nova tela **Pagamentos por recebedor**, com detalhamento por processo e acesso ao rateio de origem.
4. Configuração continua administrativa e separada da operação diária.
5. Códigos técnicos do motor permanecem para auditoria, não como linguagem principal.

## Não inventar estrutura ausente

Enquanto Conta a Receber e Conciliação Bancária não tiverem contrato de dados fechado, a UI não deve apresentar valores “previstos” derivados de recebimentos já realizados. Previsão e realizado são conceitos diferentes.

A próxima evolução estrutural deve começar por um contrato específico para **Conta a Receber + Conciliação**, preservando o motor V3 e os rateios já homologados.
