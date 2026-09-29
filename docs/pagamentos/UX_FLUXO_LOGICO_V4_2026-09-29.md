# JurisFlow · Pagamentos — modelo operacional v4

Data: 29/09/2026

## Motivo da revisão

A V3 provou o motor financeiro e a rastreabilidade, mas os testes de uso mostraram que a interface estava obrigando o usuário administrativo a entender conceitos internos do motor antes de conseguir acompanhar o dinheiro.

O problema não é a ausência de cálculo. O motor já separa entrada, regra, memória, fechamento, crédito, baixa, extrato e reservas. O problema é a ordem em que essas informações são apresentadas.

A V4 mantém o motor e reorganiza a experiência ao redor de uma pergunta operacional:

> Entrou dinheiro. Para onde foi cada centavo, quanto já foi pago e quanto ainda falta?

## Princípios da nova experiência

1. **Dinheiro primeiro, motor depois.**
   - O usuário vê primeiro entrada, destinos, pagamentos e saldo.
   - Códigos A–P, versão da regra e arredondamento continuam disponíveis para auditoria, mas em detalhe técnico recolhido.

2. **Toda entrada precisa fechar.**
   - Valor recebido = provisões + reservas + valores destinados a pessoas/empresas.
   - A interface mostra explicitamente a diferença. O esperado é R$ 0,00.

3. **Rateio e pagamento são eventos diferentes.**
   - Rateio responde quem tem direito a quanto.
   - Pagamento registra quanto dessa obrigação já foi efetivamente pago fora do JurisFlow.

4. **Reserva é uma conta própria.**
   - Constituído - gastos - transferências = saldo.
   - Gasto de reserva nunca desconta a receita uma segunda vez.

5. **Configuração usa linguagem de negócio.**
   - Primeiro pergunta o que a regra faz.
   - Depois pergunta para quem/onde, quanto, quando e em quais condomínios.
   - A conversão para estágios internos continua sendo responsabilidade do sistema.

## Navegação operacional

- **Visão geral** — conciliação do dinheiro e saldos.
- **Entradas** — valores recebidos vinculados a processos.
- **Rateios e pagamentos** — finalizar rateios e registrar pagamentos dos valores devidos.
- **Reservas** — contas separadas e seus movimentos.
- **Extrato** — histórico de valores devidos, pagamentos, ajustes e saldo.
- **Configuração** — recebedores, regras, vigências e condomínios.

## Visão geral

A tela passa a ter duas leituras distintas.

### Para onde foi o dinheiro

Somente rateios finalizados entram nesta conciliação.

- Entrou nos rateios finalizados
- Provisões constituídas
- Reservas constituídas
- Pessoas/empresas
- Total destinado
- Diferença

A diferença deve ser R$ 0,00 quando o rateio está conciliado.

### Pagamentos aos recebedores

- Total devido
- Já pago
- Ainda falta pagar

Assim a interface deixa de misturar dinheiro separado em reserva com obrigação de pagamento para recebedor.

## Entrada / processo

Ao abrir uma entrada, a ordem passa a ser:

1. contexto do dinheiro que entrou;
2. rateio operacional;
3. lista de destinos;
4. conferência `entrou x destinado`;
5. memória técnica A–P recolhida;
6. valores a pagar gerados após finalização;
7. histórico.

A lista de destinos deve permitir responder imediatamente:

- quem recebeu ou receberá;
- se o destino é pessoa/empresa, provisão ou reserva;
- qual fórmula foi usada;
- qual valor foi destinado.

## Configuração guiada

A criação de regra começa pela finalidade:

1. separar uma provisão do valor recebido;
2. pagar alguém sobre a receita líquida;
3. criar uma reserva para uma finalidade;
4. pagar participação depois das deduções;
5. distribuir o saldo final.

Depois são informados:

- destino/recebedor;
- motivo ou função;
- percentual ou valor fixo;
- vigência;
- condomínio;
- opções avançadas quando necessárias.

O valor `0` permanece válido. "Ainda não definido" continua sendo um estado diferente e bloqueia o cálculo.

## Rateios e pagamentos

A tela é dividida em duas etapas visuais:

### 1. Finalizar rateio

- lista somente entradas aptas;
- conferência antes de finalizar;
- finalização congela valores e regras;
- os destinos para pessoas/empresas viram obrigações de pagamento.

### 2. Rateios finalizados e pagamentos

- abre um rateio já finalizado;
- mostra devido, pago e saldo por recebedor;
- registra pagamento sem confundir isso com o cálculo do rateio.

Internamente o conceito de `baixa` permanece válido no domínio financeiro, mas a operação deve usar preferencialmente a expressão `registrar pagamento`.

## Extrato

A leitura operacional deve responder:

- quanto já era devido antes do período;
- quanto passou a ser devido no período;
- quanto foi pago no período;
- quanto ainda falta pagar.

A origem principal apresentada ao usuário é processo/cliente/condomínio/rateio. Códigos internos de etapa e versão continuam preservados na rastreabilidade, sem dominar a tabela principal.

## O que não muda

Esta revisão não muda:

- fórmula do motor;
- precisão monetária;
- idempotência;
- versionamento de regras;
- vigência;
- vínculo com condomínio;
- imutabilidade do rateio finalizado;
- crédito, ajuste e estorno no domínio;
- auditoria;
- regras de permissão;
- modelo de reservas;
- banco de dados.

## Critérios de aceitação da PR

- [ ] A tela inicial permite conferir `entrou = provisões + reservas + pessoas/empresas` para rateios finalizados.
- [ ] A diferença da conciliação é exibida explicitamente.
- [ ] A dívida aos recebedores é apresentada separadamente de provisões/reservas.
- [ ] A tela de entrada mostra destinos antes da memória técnica A–P.
- [ ] A memória técnica continua acessível para auditoria.
- [ ] A criação de regra não exige conhecer as letras/nomes internos do motor.
- [ ] Navegação usa `Entradas`, `Rateios e pagamentos` e `Extrato`.
- [ ] Finalizar rateio e registrar pagamento são apresentados como ações diferentes.
- [ ] Extrato usa linguagem `devido / pago / falta pagar`.
- [ ] Nenhum cálculo financeiro do backend é substituído por cálculo visual independente.
- [ ] Typecheck, lint, testes e build continuam passando.

## Relação com a especificação V3

A V4 é uma revisão de experiência e apresentação. Ela preserva o fluxo funcional aprovado na V3:

Configuração → Recebimento → Seleção de regra → Prévia → Validação → Fechamento → Crédito → Baixa → Extrato → Conciliação.

Na interface, esse fluxo é traduzido para uma linguagem operacional:

Configurar → Registrar entrada → Calcular rateio → Conferir → Finalizar rateio → Registrar pagamento → Acompanhar extrato e reservas.
