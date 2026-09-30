# Pagamentos — hardening pré-apresentação

Data: 30/09/2026

## Objetivo

Esta rodada não altera o motor A–P nem as regras financeiras aprovadas. O foco é tornar a leitura do módulo mais autoexplicativa, impedir vazamento de totais fora do escopo de acesso, reduzir carga da tela de pagamentos e transformar a integração PostgreSQL real em gate de CI.

## Fluxo que a interface deve comunicar

1. O dinheiro entra e recebe uma data de liberação.
2. O valor pode ainda estar aguardando rateio.
3. Quando o rateio é finalizado, o sistema congela a memória e separa provisões, reservas e créditos dos recebedores.
4. Pagamentos/baixas reduzem o saldo devido sem reescrever o rateio original.
5. Ajustes alteram a obrigação atual, mas não podem fazer a conciliação do rateio histórico parecer quebrada.

Por isso a Visão geral diferencia `Entrou`, `Já rateado` e `Aguardando rateio`. A conciliação `Para onde foi o dinheiro rateado?` usa os valores originais gerados pelo fechamento; ajustes posteriores continuam aparecendo na obrigação atual do recebedor, não no rateio histórico.

## Segurança de escopo

As leituras consolidadas de visão geral, fechamentos, reservas e pagamentos por recebedor devem respeitar o mesmo `processScope` aplicado às demais consultas financeiras. Usuário limitado a um condomínio não pode receber totais derivados de processos fora desse condomínio, mesmo que os detalhes continuem protegidos.

## Escalabilidade da tela Pagamentos

O agrupamento por recebedor deixa de baixar todos os créditos para o navegador. O PostgreSQL calcula o consolidado por recebedor e entrega páginas de até 30 recebedores por padrão. Os créditos detalhados de uma pessoa são carregados somente quando o usuário abre `Ver origem`.

## CI obrigatório

Toda PR deve subir PostgreSQL descartável, recriar o banco de integração financeira, aplicar todas as migrations e executar `test:integration:finance`. O teste unitário isolado continua existindo, mas não substitui os cenários transacionais reais.

## Premissas que precisam de validação no banco corporativo

### Data de cadastro usada na vigência das regras

Hoje `finance_receipt.client_registration_date` é congelada a partir de `process.created_at` no momento do lançamento. Antes de aplicar o módulo sobre uma base corporativa migrada, deve-se confirmar que `process.created_at` representa a data de cadastro do cliente usada pelo negócio para escolher a vigência financeira. Se a base original tiver outro campo oficial, o mapeamento deve ser ajustado antes da produção. Não é seguro adivinhar essa equivalência.

### Comprovantes privados

Upload/download depende do storage S3 configurado no ambiente. Antes da apresentação externa ou uso real, executar um teste autenticado de upload, listagem e download no ambiente que será demonstrado. A ausência de S3 não altera o motor financeiro, mas deixa a função de comprovantes indisponível.

### Dados de homologação

Nomes, percentuais e processos de homologação são fictícios. Não devem ser interpretados como regra remuneratória aprovada da empresa. Para apresentação, preferir identificadores claramente marcados como homologação ou substituir pelos dados validados pelo negócio.

## Fora do escopo desta PR

A camada `Conta a Receber + Conciliação` permanece como evolução estrutural separada: previsto, recebido, saldo e conciliação de uma entrada bancária com um ou vários processos. Esta PR prepara o módulo existente para essa evolução sem misturar a nova arquitetura com correções de segurança e leitura.
