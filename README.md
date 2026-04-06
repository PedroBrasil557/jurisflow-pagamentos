# JurisFlow

Sistema de gestão de processos jurídicos para regularização habitacional do programa Minha Casa, Minha Vida (MCMV). Desenvolvido para escritórios de advocacia que atuam com regularização fundiária, o JurisFlow centraliza o cadastro de beneficiários, o controle documental, a geração de PDFs e o acompanhamento do fluxo processual.

## Visão Geral

O sistema é um monorepo composto por dois serviços principais mais a infraestrutura de suporte:

| Serviço | Tecnologia | Porta |
|---------|-----------|-------|
| `web` | React 19 + Vite + TanStack Router | `3555` |
| `api` | Hono + Bun | `3556` |
| `db` | PostgreSQL 18 | `3557` |
| `minio` | Armazenamento S3-compatible | `3558` |
| `minio-console` | Interface administrativa MinIO | `3559` |

```
jurisflow/
├── api/          # Backend (Hono + Drizzle + PostgreSQL)
├── web/          # Frontend (React 19 + Vite + TanStack Router)
├── compose.yml   # Docker Compose com todos os serviços
└── CLAUDE.md     # Guia de arquitetura e padrões para o agente de IA
```

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose
- [Bun](https://bun.sh/) (para desenvolvimento local fora do Docker)

## Início Rápido

### Com Docker (recomendado)

```bash
# Subir todos os serviços
docker compose up -d

# Verificar status
docker compose ps

# Acompanhar logs
docker compose logs -f api
docker compose logs -f web

# Parar serviços (dados preservados)
docker compose down
```

> **Importante:** nunca use `docker compose down -v`. A flag `-v` apaga o volume do PostgreSQL e você perderá todos os dados.

Após subir, acesse:

- Frontend: `http://localhost:3555`
- API (health check direto): `http://localhost:3556/api/system/health`
- MinIO Console: `http://localhost:3559`

No navegador, o frontend deve ser acessado sempre por `http://localhost:3555`. Em desenvolvimento, o Vite faz proxy de todas as chamadas `'/api/*'` para a API real em `http://localhost:3556`, preservando a autenticação por cookie HTTP-only como mesma origem.

### Desenvolvimento Local

Para iterar rapidamente, rode apenas a infraestrutura no Docker e os serviços de aplicação localmente:

```bash
# 1. Subir banco e armazenamento
docker compose up -d db minio minio-create-buckets

# 2. API (terminal 1)
cd api
bun install
bun run db:migrate
bun run dev

# 3. Web (terminal 2)
cd web
bun install
bun run dev
```

## Arquitetura

### Fluxo de dados

```
Navegador
  └─ App Web (Vite/CloudFront)
       └─ Proxy same-origin em /api/*
            └─ Hono RPC Client (type-safe, via @api/ alias)
                 └─ Hono API (Bun)
                 ├─ Drizzle ORM → PostgreSQL (dados)
                 └─ AWS SDK v3  → MinIO (arquivos)
```

A inferência de tipos é propagada da definição de rotas da API até o cliente React, sem necessidade de geração de código. Qualquer mudança de contrato na API quebra a compilação do frontend imediatamente.

### Proxy da API

- **Desenvolvimento local:** o Vite serve o frontend em `http://localhost:3555` e encaminha `'/api/*'` para o alvo definido em `API_PROXY_TARGET` (por padrão `http://localhost:3556`)
- **Produção/dev em nuvem:** o CloudFront do frontend encaminha `'/api/*'` para o API Gateway
- **Objetivo:** manter o navegador sempre falando com a API pela mesma origem do app, evitando bloqueio de cookies de sessão em contextos mais restritivos, como abas anônimas

### Fluxo processual

Os processos seguem uma máquina de estados com transições controladas pelo papel do usuário:

```
EM_DOCUMENTACAO ──► DOCUMENTACAO_PRONTA ──► EM_PROCESSO ──► FINALIZADO
       │                     │                    │
       └──────────────────── ▼ ────────────────────┘
                          CANCELADO
```

| Status | Responsável | O que pode fazer |
|--------|------------|-----------------|
| `EM_DOCUMENTACAO` | Qualquer usuário | Criar, editar, fazer upload de documentos |
| `DOCUMENTACAO_PRONTA` | Advogado / Admin | Iniciar processo jurídico |
| `EM_PROCESSO` | Advogado / Admin | Editar dados jurídicos, finalizar, cancelar |
| `FINALIZADO` | — | Estado terminal — somente leitura |
| `CANCELADO` | — | Estado terminal — somente leitura |

### Perfis de acesso (roles)

| Papel | Permissões |
|-------|-----------|
| `user` | Cadastrar e gerenciar documentação de processos |
| `attorney` | Tudo de `user` + iniciar, editar jurídico, finalizar e cancelar |
| `admin` | Tudo de `attorney` + gerenciar usuários e conjuntos habitacionais |

## Documentação por serviço

- [api/README.md](api/README.md) — arquitetura, módulos, padrões e guia de contribuição do backend
- [web/README.md](web/README.md) — arquitetura, rotas, componentes e guia de contribuição do frontend

## Variáveis de Ambiente

Cada serviço possui seu arquivo `.env` próprio. Veja os arquivos `.env.example` em `api/` e `web/`.

Principais variáveis da API:

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | String de conexão PostgreSQL |
| `BETTER_AUTH_SECRET` | Segredo para assinatura de sessões (mínimo 32 chars) |
| `BETTER_AUTH_URL` | URL pública do app web usada pelo better-auth para emitir cookies e endpoints públicos (ex.: `http://localhost:3555`) |
| `WEB_URL` | URL do frontend para configuração de CORS |
| `S3_ENDPOINT` | Endpoint MinIO (ex.: `http://localhost:3558`) |
| `S3_ACCESS_KEY_ID` | Chave de acesso MinIO |
| `S3_SECRET_ACCESS_KEY` | Segredo MinIO |

Principais variáveis do Web:

| Variável | Descrição |
|----------|-----------|
| `VITE_API_URL` | Fallback para desenvolvimento/local. No ambiente publicado o web usa `window.location.origin` como origem pública do app |
| `API_PROXY_TARGET` | Somente desenvolvimento. Alvo real da API para o proxy do Vite (ex.: `http://localhost:3556`) |

## Convenções do Projeto

- **Idioma da UI:** português (pt-BR) — todo texto visível ao usuário deve estar em pt-BR
- **Formatação:** Biome em ambos os serviços (sem Prettier ou ESLint)
  - Sem ponto e vírgula
  - Aspas simples
  - Indentação com 2 espaços
- **Commits:** português, formato `tipo: descrição curta` (ex.: `feat: adiciona filtro por status`)
- **Branches:** criadas a partir de `dev`; `main` é exclusiva para produção

## Como Contribuir

1. **Crie uma branch** a partir de `dev`:
   ```bash
   git checkout dev && git pull
   git checkout -b feat/minha-feature
   ```

2. **Implemente** seguindo os padrões de cada serviço (veja READMEs internos)

3. **Verifique** antes de abrir o PR:
   ```bash
   # API
   cd api && bun run lint && bun run typecheck

   # Web
   cd web && bun run lint && bun run typecheck
   ```

4. **Abra o PR** apontando para `dev`. PRs direto para `main` são rejeitados (exceto deploys via CI)

5. **Revisão:** aguarde pelo menos uma aprovação antes de fazer merge

## Licença

Proprietário — ICSF Solutions. Todos os direitos reservados.
