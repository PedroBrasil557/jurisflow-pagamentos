# Preview pessoal na Vercel — estado e requisitos

Branch isolada: `chore/vercel-preview` (base `feat/pagamentos-local` em `69f5069`). Esta branch não altera `main`, `dev` nem o trabalho local do Claude.

## Preparado

- `vercel.json` declara dois serviços: `web` (Vite, rota `/`) e `api` (Hono, rota `/api/*`).
- `api/server.ts` exporta o app Hono para Vercel Functions. `api/src/index.ts` continua atendendo o desenvolvimento local em Bun.
- Projeto Supabase de demonstração separado: `JurisFlow Pagamentos Demo`, ref `uzgbmvgnsztrxlaatger`, região `sa-east-1`, custo informado `US$ 0/mês`.

## Antes de publicar

1. Conectar a Vercel à branch desta configuração. O importador web escolhe `main` por padrão; **não publicar `main` como demo**, pois não contém a configuração nem o código de Pagamentos. Uma alternativa é executar Vercel CLI a partir do checkout da branch preparada, vinculando à equipe `icewelders-projects`.
2. Configurar um `DATABASE_URL` de pooler IPv4 para o banco de demo. O hostname exato deve vir do painel Supabase; não deduzir o índice do pooler pela região. Usar senha exclusiva de banco, salvar apenas como variável secreta na Vercel. Não versionar credenciais.
3. Aplicar as migrations Drizzle ao banco de demo e carregar **somente dados fictícios**. Não usar dados reais da ICSF.
4. Conceder acesso ao esquema apenas ao papel de app, proteger tabelas expostas no Supabase e verificar os avisos de segurança da plataforma.
5. Configurar `BETTER_AUTH_SECRET` exclusivo, `BETTER_AUTH_URL` e `WEB_URL` no domínio HTTPS final, `TRUSTED_ORIGINS`, `MASTER_ADMIN_CPFS` somente se necessário. Não usar padrões de desenvolvimento em público.
6. Configurar armazenamento S3 privado para documentos ou desativar fluxos de upload que dependem dele até a adaptação. O MinIO local não é acessível pela Vercel.
7. Confirmar `GET /api/system/health`, login com usuário fictício, páginas, rotas `/api/*`, acesso negado sem sessão e navegação direta em rotas profundas. Testar upload e worker separadamente quando hospedados.

## Limite do preview

O `ingestion-worker`, o `worker` de RPA e o serviço `scan-enhance` são processos separados no Compose e não passam a executar continuamente apenas com esta configuração. Rotas dependentes deles precisam de adaptação ou marcação explícita como indisponíveis na demo. A primeira publicação só está pronta quando web + API + banco + autenticação forem testados pelo URL público.
