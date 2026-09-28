# JurisFlow · Pagamentos
## Relatório de refinamento visual, funcional e técnico

**Data:** 28 de setembro de 2026 · **Entrega local pretendida:** sábado, 3 de outubro de 2026  
**Base de trabalho informada:** `origin/main` em `bac53ab4b05362751ccb7270f09ef0aaaf703552`, branch local `feat/pagamentos-local`  
**Situação deste relatório:** materiais, Figma e commit de segunda-feira conferidos no GitHub privado. Os resultados dos testes do Claude ainda não foram reexecutados por esta revisão.

## 1. Resumo executivo e evidência

O objetivo da semana permanece: um módulo Pagamentos **funcional e testado localmente** sobre a base efetiva do JurisFlow até quinta-feira, com sexta-feira e sábado dedicados à verificação e correção. Integração ao repositório da empresa, PR, merge e produção são decisões posteriores com o mantenedor. O `dev` observado está 289 commits atrás da `main` usada no clone, portanto a branch local não deve ser aberta diretamente contra esse `dev` antigo.

O commit `9ce77b8f0d708b478f39822697743fe016f47924` foi verificado no repositório pessoal privado, exatamente um commit acima da base `bac53ab4`. O diff confirma motor financeiro puro, migration `0037_finance_payments.sql`, permissões de base e testes adicionados. Os números de 123 testes de API aprovados (26 ignorados) e 38 testes financeiros de integração aprovados são **relato de execução do Claude**, não reexecução independente. Naquele checkpoint ainda não existiam serviços, rotas e telas do módulo; a migration não estava aplicada ao banco `app`, e comprovantes não haviam sido testados por falta de S3 local. Portanto ainda não é correto declarar Pagamentos disponível no `localhost` nem a entrega concluída.

No Figma foi criada uma página separada, **“Pagamentos · Versão final”**, com o guia e 20 telas: as telas 01–15 da operação principal refinadas e as telas 16–20 para a importação futura de Excel. As últimas cinco estão identificadas visualmente como **fase futura**, evitando confundir o desenho com funcionalidade pronta para sábado. Foram inspecionadas visualmente a capa e as telas de envio, mapeamento, prévia e histórico; nenhuma apresentou corte evidente no enquadramento. O arquivo ainda é um **modelo visual**, não um protótipo de navegação validado por usuários finais.

**Figma:** [Pagamentos · Versão final](https://www.figma.com/design/9R630MtCieeG86kfR1hVjM?node-id=50-2)  
**Plano anterior:** `PLANO_MODULO_PAGAMENTOS_JURISFLOW_2026-09-27.md` permanece a referência para o cronograma e a matriz de testes já detalhada; este documento esclarece a nova leitura visual e a extensão por planilhas.

## 2. O que foi realmente analisado

| Fonte | Conclusão útil | Limite da evidência |
|---|---|---|
| Documento `JURIS_FLOW_FUNCIONALIDADES_2026_09(1).docx` | Define pessoas, períodos, conjuntos, tributo, apoio, certidão, cartório, fechamento e extratos; há uma etapa posterior para reembolso da provisão. | Não resolve sozinho a ordem exata da cascata, as datas de todas as rubricas ou aprovação por segunda pessoa. |
| `MCMV_REGISTRO_SIMULACAO_GERAL_FINAL(1).xlsx` | É uma simulação de cálculo, com uma aba e 21 linhas. | Não é um livro de recebimentos. `D1` está vazio apesar de usado por fórmulas; há percentuais descritos em texto e uma rubrica sem fórmula. Não usar como importação real ou oráculo numérico. |
| ZIP da `main` enviado anteriormente | Mostra React/Vite/TanStack Router, Hono/Bun, Drizzle/PostgreSQL, permissões por perfil, S3 e rotas por módulo. | É um retrato anterior ao trabalho atual do Claude. Não permite comprovar migration, rotas, UI ou testes do commit `9ce77b8`. |
| Commit `9ce77b8` e relatório do Claude | Diff de 24 arquivos confirma motor, schema, migration, permissões e testes adicionados; o relatório descreve um caso de R$ 12.000,00. | Sem acesso ao banco Windows e aos logs completos, os números de teste não foram reexecutados por esta revisão. |
| Figma existente | Fornece linguagem visual coerente com o JurisFlow, telas desktop e mobile e fluxo financeiro inicial. | Os exemplos fictícios nas telas não homologam regras de negócio. |

## 3. Contrato financeiro apresentado na interface

O usuário precisa sempre saber **de onde o dinheiro entrou, o que ficou provisionado, o que está disponível, quanto cabe a cada pessoa e o que foi efetivamente pago**. São fatos diferentes e devem ocupar colunas e estados separados.

| Conceito | O que representa | Como aparecer na UI | Consequência técnica |
|---|---|---|---|
| Recebimento | Entrada bruta por processo e rubrica, com data de liberação, origem e comprovante. | “Recebido”, “a conferir” e histórico do processo. | Identidade idempotente; não confundir com transferência ao destinatário. |
| Tributo | Provisão de 20% do bruto segundo a regra de trabalho. | Linha discriminada na prévia e no fechamento. | Snapshot do percentual e da base de cálculo. |
| Apoio | Provisão de 4% do líquido segundo a regra de trabalho. | Reserva de apoio, com saldo próprio. | Sua destinação e eventual reembolso ficam pendentes de homologação/etapa posterior. |
| Certidão | Reserva fixa de R$ 500,00 no primeiro recebimento elegível do processo. | “Reservado”, “consumido”, “saldo”. | Unicidade por processo, concorrência protegida e reversão auditável. |
| Cartório | Despesa que consome reserva de certidão, quando autorizada. | Movimento no livro de reserva; jamais campo que altera silenciosamente o bruto recebido. | Bloquear saldo negativo e exigir evidência/motivo conforme política. |
| Participação | Wilamy, líderes e prospectadores elegíveis por conjunto e vigência. | Uma linha por pessoa e regra aplicada; zero apenas quando o caso de exemplo assim definir. | Percentual sobre o líquido, por data de cadastro definida e regra versionada. |
| Cascata | Rateio residual demonstrativo entre Ivanildo, Wilomar, Gean e Inova. | Prévia com base, percentuais, valores e versão usada. | A ordem e os percentuais ainda exigem caso real aprovado; impedir uso operacional antes disso. |
| Baixa | Marca pagamento feito fora do sistema, com data e comprovante. | “A pagar”, “Pago”, “Estornado”, recebedor e referência. | Evento auditável; baixa não cria um segundo recebimento. |

**Exemplo demonstrativo do motor relatado:** R$ 12.000,00 bruto = R$ 2.400,00 tributo + R$ 384,00 apoio + R$ 500,00 certidão + R$ 4.358,00 Ivanildo + R$ 2.614,80 Wilomar + R$ 697,28 Gean + R$ 1.045,92 Inova, com participações variáveis zeradas nesse caso. As parcelas somam exatamente R$ 12.000,00. Uma despesa de cartório de R$ 180,00 e outra de R$ 100,00 deixam R$ 220,00 da reserva; essas despesas são movimentos posteriores, não parcelas extras no rateio.

## 4. Revisão das telas e do caminho do usuário

### Fase 1 — fluxo da entrega local

| Tela Figma | Pergunta que a tela resolve | Refinamento e critério de leitura |
|---|---|---|
| 01 Visão geral | O que entrou, falta conferir, está reservado ou a pagar? | Indicadores com período/filtro visíveis e vínculo com lista de origem; nunca somar grandezas incompatíveis no mesmo cartão. |
| 02 Novo recebimento | Qual processo, rubrica, valor, data e prova desta entrada? | Campo “Situação do recebimento”; comprovante do recebimento. Despesa de cartório vai ao livro de reservas. |
| 03 Prévia do rateio | Como cada centavo foi distribuído? | Mostrar base da rubrica, versão da regra, participações zeradas apenas no exemplo, reserva na primeira entrada e saldo reconciliado. |
| 04 Fechamento | Quais entradas entram neste fechamento? | Competência, período, itens incluídos, exclusões justificadas e travas antes da confirmação. |
| 05 Extratos | Quanto cabe a cada recebedor e por quê? | Pessoa, processo, conjunto, rubrica, data, valor devido, baixado e pendente. |
| 06 Regras | Que percentuais estavam vigentes para este caso? | Vigência, escopo de conjunto, estado rascunho/publicado, histórico e conflitos sem desempate implícito. |
| 07 Pendências | O que impede continuar? | Mensagens específicas e ação corrigível, como comprovante ausente; sem bloqueio genérico de cartório para todo recebimento. |
| 08–09 Mobile | Dá para consultar pendências e prévias em campo? | Leitura e navegação com dados essenciais; operações críticas devem ser verificadas com cuidado em tamanhos menores. |
| 10 Entradas | Onde localizar cada recebimento? | Busca por processo, ID, data, situação e rubrica; fonte e comprovante acessíveis segundo permissão. |
| 11 Profissionais/vigências | Quem era elegível? | Identidade distinta, função, escopo, período, percentual, publicação e histórico. |
| 12 Reservas/saldos | O que foi provisionado e consumido? | Livro separado para certidão e apoio; saldo inicial + entradas - saídas = saldo atual. |
| 13 Baixas | Quem já recebeu fora do sistema? | Comprovantes separados por destinatário e estornos sem exclusão histórica. |
| 14 Processo/histórico | O que aconteceu com este processo ao longo do tempo? | Segundo recebimento já liberado, reserva única do processo e ligações entre eventos. |
| 15 Estados de interface | Como o sistema se comporta fora do caso ideal? | Vazio, carregando, erro, acesso negado, conflito e conclusão com instrução clara. |

**Ajustes já aplicados no Figma:** “Novo lançamento” passou a “Novo recebimento”; campo de cartório removido do formulário de entrada; prévia identifica explicitamente o exemplo sem participações; pendência genérica substituída por falta de comprovante; documentos da baixa separados por pessoa; segundo recebimento marcado “Recebido · a conferir”. A página original foi preservada.

### Fase futura — importação operacional de Excel

| Tela Figma | Ação do usuário | Proteção fundamental |
|---|---|---|
| 16 Importar planilha | Enviar `.xlsx`, informar origem e tipo. | Arquivo privado, limites de tamanho/expansão e aviso de que a simulação fornecida não é um livro real. |
| 17 Mapear colunas | Escolher aba e mapear ID, processo, valor, data, rubrica. | Prévia de valores, versões do mapa, identificação explícita de processo ambíguo. |
| 18 Validar linhas | Resolver aptas, ambíguas, duplicadas e inválidas. | Erro por linha; ignorar com justificativa; nada gravado até aprovação. |
| 19 Prévia/aprovação | Conferir totais de origem e de importação e efeito do motor. | Dry-run com diferença zero em centavos; exclui pendências; exige responsável autorizado. |
| 20 Histórico | Ver lote, arquivo, operador, mapa, linhas e resultado. | Hash e origem, links para recibos, correção por evento auditado e reimportação idempotente. |

O exemplo de 128 linhas nas telas se divide em 112 aptas, 9 ambíguas, 5 duplicadas e 2 inválidas. Se apenas as 112 aptas forem confirmadas, o histórico mostra 112 criadas, 5 ignoradas e 11 pendentes. Esses números são **dados fictícios de UX**, não medição de uma planilha da empresa.

## 5. Extensão técnica para planilhas sem comprometer o módulo

Planejar agora a fronteira de importação, mas implementá-la depois da entrega local, com planilhas operacionais reais e dados anonimizados para testes. O núcleo financeiro deve oferecer um serviço de criação idempotente de recebimentos tanto para o formulário quanto para um lote futuro; o importador não deve escrever diretamente em tabelas de fechamento, distribuição ou reserva.

1. **Receber e guardar:** validar extensão, assinatura do arquivo, tipo, tamanho, quantidade de abas/linhas/células e expansão de ZIP; armazenar original privado com hash SHA-256 e controle de acesso. Recusar macros e links externos ou neutralizar conteúdos não suportados. A validação de uploads deve ser feita no servidor, seguindo a orientação OWASP: [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
2. **Preparar um lote imutável:** registrar origem, hash, versão do layout, aba, cabeçalhos, operador, horários e linhas brutas; guardar a grafia e a posição original de cada valor. Uma planilha corrigida gera outro lote, ligado ao anterior, sem sobrescrever a origem.
3. **Mapear:** relacionar cabeçalhos a campos do domínio. Exigir ID externo estável, processo inequívoco, rubrica, valor monetário positivo e data de liberação; opcionalidade de comprovante depende da política de negócio. Nunca executar fórmulas da planilha ou aceitar um valor derivado como fonte de verdade sem conferência explícita. A documentação do SheetJS confirma que fórmula e valor de célula são propriedades distintas: [Formulae](https://docs.sheetjs.com/docs/csf/features/formulae/).
4. **Validar e resolver:** analisar duplicidade por `(origem, ID externo)` e hash/semelhança do conteúdo, processo inexistente ou ambíguo, datas e rubricas, permissões e estado. Guardar diagnósticos por linha e a decisão humana com motivo.
5. **Simular:** chamar o mesmo motor versionado da entrada manual, produzir prévia por pessoa/rubrica/processo, reconciliar centavos e detectar regra ausente ou conflito. A prévia deve expirar ou ser refeita se regras, processos ou saldos relevantes mudarem antes de aprovar.
6. **Confirmar em transação:** revalidar sob concorrência, inserir apenas linhas aprovadas por pessoa autorizada, atribuir o vínculo de origem e gravar eventos de auditoria. Constraint de unicidade e controle de concorrência no PostgreSQL complementam a checagem na UI; em caso de falha serializável é necessário repetir a transação completa, como explica a [documentação do PostgreSQL](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html).
7. **Conservar e corrigir:** exibir o histórico e exportar erros; uma correção posterior gera evento compensatório/estorno com motivo e relações explícitas. Não reescrever lançamentos de um fechamento ativo.

**Tabelas futuras propostas** (nomes ainda sujeitos à convenção final do repositório): `finance_import_batch`, `finance_import_mapping_version`, `finance_import_row`, `finance_import_resolution` e relação `receipt.import_row_id`. Campos mínimos: hash do arquivo, chave da origem, versão, aba, linha, payload bruto normalizado, diagnóstico, decisão, usuário e timestamp, receipt criado. IDs e índices devem permitir reprocessar sem duplicar. Retenção, criptografia e acesso aos originais devem seguir a política da empresa.

**Critério de entrada para construir essa fase:** receber 2–3 planilhas operacionais reais anonimizadas, com cabeçalhos representativos, uma linha normal, uma duplicada, uma ambígua, uma retificação, recibos reais esperados e total de conferência assinado pelo financeiro. Sem isso, só é seguro concluir a arquitetura e o protótipo.

## 6. Pendências de negócio e decisão de apresentação

| Ponto | Situação atual | Conduta até homologação |
|---|---|---|
| Cascata e percentuais de Ivanildo, Wilomar, Gean e Inova | Hipótese demonstrativa no motor e no Figma. | Validar com ao menos um caso real completo assinado por quem calcula/paga; bloquear fechamento operacional real se divergir. |
| Data da cascata e data de cadastro em rascunhos/importações | A data de liberação foi usada para a cascata como hipótese; `process.createdAt` pode não ser a data empresarial. | Exibir as duas datas e a regra escolhida na prévia; definir a política de correção histórica com auditoria. |
| Multa e sucumbência | Não está claro se seguem o rateio dos honorários. | Manter rubricas segregadas; não aplicar a cascata automaticamente. |
| Conferência por outra pessoa | Segregação de funções não homologada. | Permissão separada e trilha pronta; confirmar se a mesma pessoa pode lançar e conferir. |
| Destino dos 4% de apoio | Provisão prevista; reembolso/distribuição posterior. | Mostrar saldo e movimentos, não interpretar como valor já pago. |
| Perfis com acesso ao financeiro | O checkpoint relata permissão negada por padrão, exceto MASTER. | Lista nominal de perfis/pessoas aprovada pelo responsável; testar leitura e mutação por papel. |
| Comprovantes e uploads | S3 local ainda sem teste no checkpoint. | Resolver o serviço local antes de aceitar a fase 1; testar autorização de download e reversão de falhas. |

Para apresentação à empresa, diferenciar **“demonstrado com dados fictícios”**, **“implementado e testado”** e **“regra homologada para valores reais”**. Uma tela bonita ou um teste verde do motor não substitui o aceite da fórmula por quem hoje opera a planilha.

## 7. Plano de execução até sábado

| Dia | Entrega de engenharia | Evidência necessária |
|---|---|---|
| Segunda, 28/09 | Contrato, motor, schema, migration, integrações de banco e permissões de base. | Checkpoint do Claude recebido; inspeção independente do código ainda pendente. |
| Terça, 29/09 | Acesso em todos os serviços/rotas, destinatários e regras versionadas, recebimentos e prévia; S3 local para provas; migration em `app`. | Cenários API e banco, upload/download autorizados, casos de conflito e duplicidade. |
| Quarta, 30/09 | Telas 01–03, 06–07, 10–11 e 14, fluxo com dado fictício de ponta a ponta; começar fechamento/baixa/reserva. | Capturas de UI com estado real e navegação a partir do JurisFlow. |
| Quinta, 01/10 | Fechamento, extratos, reservas, baixas, estados da UI, permissões, mobile essencial e documentação Windows. Congelar escopo. | API/web lint, typecheck, testes, build, banco limpo migrado, E2E manual ou automatizado. |
| Sexta, 02/10 | QA intensivo: concorrência, cálculo em centavos, autorização, histórico, prova, estorno e regressão de Processos. | Casos com entradas/saídas esperadas, logs e defeitos corrigidos. |
| Sábado, 03/10 | Reteste das correções, demonstração local e pacote de entrega ao responsável. | SHA, changelog, migrations, comandos, evidências, limitações e decisão pendente de integração. |

O fluxo completo da fase 1 é: **regra publicada → recebimento com prova → prévia reconciliada → conferência → fechamento → extrato → baixa com comprovante → reserva movimentada → histórico auditável**. Cada transição deve ter uma mensagem de erro acionável e permissionamento no servidor. A importação Excel é extensão planejada, **não requisito para a entrega de sábado**.

## 8. Checklist de aceite prático

- [ ] Instalar/migrar em banco vazio; aplicar `0037` no banco local de desenvolvimento sem afetar outro projeto.
- [ ] Fazer um recebimento de R$ 12.000,00 e obter as parcelas do caso demonstrativo, soma exata e versão de regra visível.
- [ ] Fazer um segundo recebimento no mesmo processo, com reserva de certidão zero, sem permitir corrida de duas primeiras entradas.
- [ ] Registrar despesas de R$ 180,00 e R$ 100,00 e ver saldo R$ 220,00; rejeitar R$ 220,01.
- [ ] Validar vigências e escopo por conjunto; conflito “todos os conjuntos” versus específico não é resolvido silenciosamente.
- [ ] Confirmar que um usuário sem permissão não vê lista, valores nem comprovantes por URL/API direta.
- [ ] Fazer upload e download privado do comprovante e tratar falha do armazenamento sem lançamento órfão.
- [ ] Fechar, baixar, estornar e consultar extrato individual sem apagar histórico.
- [ ] Retestar exclusão de processo com e sem vínculos financeiros.
- [ ] Inspecionar desktop e mobile, telas de vazio/erro/carregamento e navegação de `/pagamentos`.
- [ ] Executar scripts de qualidade do API e Web e guardar resultados; repetir em banco `_test` isolado.
- [ ] Validar fórmula e acessos com responsável empresarial antes de operar dinheiro real.

## 9. Próximo comando de trabalho para o Claude

> Continue na branch local `feat/pagamentos-local` após `git pull --ff-only entrega feat/pagamentos-local`, confirmando o novo HEAD dos documentos, sem merge com a ICSF. Primeiro reporte `git status`, `HEAD`, migrations e arquivos alterados. Compare `CONTRATO.md`, `PROGRESSO.md` e `ETAPA_2_2026-09-29.md` com este refinamento e com as telas 01–15 da página “Pagamentos · Versão final” no Figma. Entregue a etapa de terça: acesso financeiro em todos os serviços/rotas, regras e destinatários versionados, recebimento idempotente, prévia, auditoria e comprovantes privados; aplique a migration no `app` local depois de verificar o banco alvo, e faça um caso fictício de ponta a ponta. Resolva o S3 local ou prove solução equivalente compatível com a interface de armazenamento, sem apagar dados. Rode os testes de API/banco pertinentes, lint/typecheck e anote evidências reproduzíveis. Não implemente as telas 16–20 nem importação Excel esta semana; preserve a futura fronteira de serviço. Pode publicar commits de desenvolvimento somente no remoto pessoal `entrega`, nunca na ICSF sem alinhamento posterior. Pare apenas para pedir decisão empresarial sobre uso de regra não homologada em operação real, sem interromper implementação/testes com dados fictícios.

## 10. Limites desta entrega de refinamento

Este trabalho entregou o desenho final no Figma, o plano refinado e a conferência do commit `9ce77b8` no GitHub privado. **Não alterou a branch local do Windows, não publicou o módulo em produção, não executou a migration no `app` e não reexecutou os testes do checkpoint do Claude.** Para confirmar execução local, ainda são necessários logs/testes e demonstração no Windows. As decisões empresariais em aberto continuam identificadas acima.
