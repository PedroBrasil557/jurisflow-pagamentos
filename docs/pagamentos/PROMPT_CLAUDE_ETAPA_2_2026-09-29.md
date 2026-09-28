# Prompt para Claude Code · JurisFlow Pagamentos · Etapa 2

Você é o agente implementador do módulo **Pagamentos** do JurisFlow. Trabalhe no Windows em `C:\Users\pedro\Projetos\jurisflow-pagamentos`, exclusivamente na branch `feat/pagamentos-local`. O remoto `origin` é o repositório da ICSF; `entrega` é o espelho **privado** autorizado `PedroBrasil557/jurisflow-pagamentos`. Não faça push para `origin`, PR, merge, deploy ou operação com dinheiro real. O prazo de engenharia da etapa 2 é terça-feira, 29/09/2026; o sistema completo deve estar pronto na quarta/quinta e a sexta/sábado são para QA.

## 0. Preflight obrigatório, antes de editar

1. Confirme diretório, branch, `git status --short --branch`, `git remote -v` e SHA atual. O último commit de código de segunda-feira é `9ce77b8f0d708b478f39822697743fe016f47924`, descendente de `bac53ab4b05362751ccb7270f09ef0aaaf703552`.
2. Os documentos desta revisão foram commitados **depois** do último push do Windows. Se a árvore local estiver limpa, execute `git pull --ff-only entrega feat/pagamentos-local`. Confirme o HEAD remoto atualizado e o status limpo. Se houver mudanças locais, preserve-as e resolva o motivo antes do pull; nunca use `reset --hard`, `clean -fd`, rebase ou force-push como atalho.
3. Leia `CLAUDE.md`, `api/README.md`, `web/README.md`, `docs/pagamentos/CONTRATO.md`, `docs/pagamentos/PROGRESSO.md`, `docs/pagamentos/ETAPA_2_2026-09-29.md` e `docs/pagamentos/REFINAMENTO_2026-09-28.md`. Inspecione as rotas Hono, middleware de sessão/permissão, schema, serviço de processos, módulo de storage S3 e scripts reais. O documento da etapa 2 prevalece para **escopo e ponto de parada**; o contrato existente permanece a descrição das hipóteses do motor.
4. Registre no início do relatório qualquer divergência entre contrato, schema, código e Figma. Não invente regra de negócio para eliminá-la. Trabalhe apenas com dados fictícios.

## Missão fechada desta etapa

Entregue o backend que permita demonstrar por API: **regra publicada → recebimento fictício idempotente com comprovante privado → prévia reconciliada → leitura permitida apenas ao usuário autorizado → auditoria**. O banco `app` local deve receber a migration `0037` somente após conferir que `DATABASE_URL` aponta ao Postgres isolado `pagamentos-local`; a suíte de integração usa somente banco terminado em `_test`. Não altere ou apague volumes de banco.

### Ordem de implementação

1. `finance.access.ts`: defina verificações de flags e `processScope`; operações globais exigem escopo `all` além da flag. Filtre listagens no SQL e proteja detalhe, mutação e comprovantes no servidor. MASTER mantém a semântica existente; admin comum continua negado se o perfil não conceder `financeiro`. Cubra 403/404 sem vazar dados.
2. Destinatários financeiros com identidade estável, validação e auditoria. Regras em rascunho/publicada/revogada, vigência inclusiva, conjunto ou geral, papel, percentual e revisão. Publicação atômica com trava/checagem de conflito entre escopos e períodos; nunca desempate por especificidade. Regra publicada não recebe edição silenciosa; revisão preserva snapshot e motivo.
3. Recebimentos: validação estrita de valor em centavos, tipo, processo, data civil em America/Sao_Paulo, referência, prova e chave de idempotência. Mesmo pedido repetido devolve o mesmo registro; mesma chave com payload diferente retorna conflito sem mutação. Estados e transições auditados. Proíba alteração que comprometa fechamento futuro. Use transações/constraints para corridas simultâneas.
4. Prévia: reutilize `finance.engine.ts`; exponha base, versão do algoritmo, regras e datas aplicadas, linhas por destinatário, alertas e soma exata em centavos. **A reserva de certidão aparece como reserva potencial na prévia; `finance_reserve_movement` é constituído apenas no fechamento da etapa seguinte.** Em duas entradas do mesmo processo, atribua a reserva potencial uma única vez, de forma determinística, sem gravar saldo fictício nesta etapa.
5. O contrato atual assume que `MULTA` e `SUCUMBENCIA` seguem a fórmula dos honorários, mas isso ainda não foi homologado. Deixe essas rubricas separadas e identificadas como hipótese; não as use no caso demonstrativo aprovado. Faça o fluxo operacional de teste com `HONORARIOS_CONTRATUAIS`. Cascata Ivanildo/Wilomar/Gean/Inova e datas também continuam hipóteses; não liberar dados reais.
6. Configure armazenamento S3 compatível local, resolvendo a falha do MinIO sem usar imagens inexistentes nem `docker compose down -v`. Comprovantes devem ficar privados; validar tamanho/tipo, chave, upload, download autorizado, remoção/compensação e falhas parciais. Não guardar objeto público nem deixar registro órfão.
7. Monte rotas Hono e serviços seguindo padrões existentes, schemas de validação e cliente tipado. Faça um seed **fictício** da cascata demonstrativa, sem dados pessoais reais, somente no ambiente local adequado. Atualize `docs/pagamentos/PROGRESSO.md` com decisões e comandos Windows reproduzíveis.

## Verificação necessária antes de encerrar

- Publique regra válida e rejeite sobreposição geral/específica e concorrência de publicação.
- Demonstre recebimento fictício de R$ 12.000,00 e reconciliação em centavos; teste segundo recebimento, chave repetida e chave repetida com payload divergente.
- Prove que o livro de reserva ainda não foi constituído e que a prévia conjunta reserva uma vez por processo.
- Prove autorização com usuários de escopos distintos, inclusive acesso direto à URL do arquivo.
- Faça upload/download privado e teste falha de storage antes/depois da gravação no banco.
- Rode `bun run db:check`, migration em banco de teste limpo e no `app` local após inspecionar o alvo, `bun test`, `bun run test:integration:finance`, lint/typecheck da API; rode os gates Web pertinentes para regressão (lint, typecheck, teste e build). Corrija falhas introduzidas e informe avisos preexistentes separadamente.
- Faça smoke HTTP de ponta a ponta, com entradas, respostas e IDs fictícios reproduzíveis. Se algum critério não puder passar, descreva bloqueio técnico preciso e não declare a etapa pronta.

## Parada obrigatória e saída

Pare **assim que** o fluxo de backend e E2-01 a E2-10 do documento da etapa 2 estiverem comprovados. **Não** inicie telas, fechamento, baixas, extratos, importação Excel, PR ou merge. A próxima etapa será autorizada depois da revisão deste checkpoint.

Faça commits locais pequenos e claros em português. Após os gates e a revisão do diff, pode enviar apenas para `entrega/feat/pagamentos-local` (espelho pessoal privado autorizado), sem força. No relatório final, informe: HEAD inicial/final, arquivos, migrations aplicadas e bancos alvo, testes com contagens, cenário HTTP, screenshot ou evidência de armazenamento, pendências de negócio, riscos e exatamente o que falta para as telas. Não alegue que `/pagamentos` está disponível no navegador se não estiver.
