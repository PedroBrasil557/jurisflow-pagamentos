# Preview pessoal na Vercel — estado e requisitos

Branch isolada: `chore/vercel-preview` (base `feat/pagamentos-local` em `69f5069`). Esta branch não altera `main`, `dev` nem o trabalho local do Claude.

## Preparado

- `vercel.json` declara dois serviços: `web` (Vite, rota `/`) e `api` (Hono, rota `/api/*`).
- `api/server.ts` exporta o app Hono para Vercel Functions. `api/src/index.ts` continua atendendo o desenvolvimento local em Bun.
- Projeto Supabase de demonstração separado: `JurisFlow Pagamentos Demo`, ref `uzgbmvgnsztrxlaatger`, região `sa-east-1`, custo informado `US$ 0/mês`.

## Estado do projeto Vercel

- Projeto `icewelders-projects/jurisflow-pagamentos` criado pelo proprietário a partir de `main/web`, commit `bac53ab`. O frontend está pronto, mas `GET /api/system/health` retorna 404 porque a API não estava no build.
- Project Settings > Build and Deployment foi ajustado para raiz do repositório (campo vazio) e Framework Preset `Services`. O deployment anterior de produção continua servindo o build estático. Esta branch fornece o `vercel.json` que será usado no novo preview.
- Na entrada Hono para Vercel, `DATABASE_URL` e `BETTER_AUTH_SECRET` são obrigatórios. Na ausência de `BETTER_AUTH_URL` e `WEB_URL`, a origem HTTPS do deployment é usada para cookies e CORS.
- O banco Supabase de demo recebeu as 38 migrations do Drizzle e seu journal, sem seed de pessoas/processos. As 40 tabelas em `public` têm RLS ativo e nenhum `SELECT` para `anon`; defaults de grants foram revogados. A migration 0014 criou apenas `JurisFlow Bot`, sem credencial de login.

## Antes do preview funcional

1. Configurar um `DATABASE_URL` de pooler IPv4 para o banco de demo. O hostname exato deve vir do painel Supabase; não deduzir o índice do pooler pela região. Usar senha exclusiva de banco, salvar apenas como variável secreta na Vercel. Não versionar credenciais.
3. Criar acesso de aplicação ao banco e carregar **somente dados fictícios**. Não usar dados reais da ICSF. A conta de demonstração não deve usar senha conhecida do seed local.
4. Conferir os avisos de segurança do Supabase; a Data API não participa da arquitetura do JurisFlow, então nenhuma política RLS de acesso direto pelo cliente foi concedida.
5. Configurar `BETTER_AUTH_SECRET` exclusivo na Vercel. O preview usa `VERCEL_URL` para `BETTER_AUTH_URL` e `WEB_URL` por padrão; revisar o hostname exato ao promover para produção. Definir `ENVIRONMENT=prod`, `DB_POOL_MAX=1`, `GEOIP_ENABLED=false` para a demonstração. Não usar padrões de desenvolvimento em público.
6. Configurar armazenamento S3 privado para documentos ou desativar fluxos de upload que dependem dele até a adaptação. O MinIO local não é acessível pela Vercel.
7. Confirmar `GET /api/system/health`, login com usuário fictício, páginas, rotas `/api/*`, acesso negado sem sessão e navegação direta em rotas profundas. Testar upload e worker separadamente quando hospedados.

## Limite do preview

O `ingestion-worker`, o `worker` de RPA e o serviço `scan-enhance` são processos separados no Compose e não passam a executar continuamente apenas com esta configuração. Rotas dependentes deles precisam de adaptação ou marcação explícita como indisponíveis na demo. A primeira publicação só está pronta quando web + API + banco + autenticação forem testados pelo URL público.
