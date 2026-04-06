# Web — JurisFlow

Frontend do JurisFlow. Aplicação React 19 SPA com Vite, roteamento file-based com TanStack Router, estado de servidor com React Query e UI construída sobre shadcn/ui + Tailwind CSS 4.

## Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | React 19 + Vite |
| Roteamento | [TanStack Router](https://tanstack.com/router) (file-based) |
| Estado do servidor | [TanStack React Query](https://tanstack.com/query) |
| UI | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS 4 + Radix UI |
| Formulários | react-hook-form + Zod |
| Cliente HTTP | Hono RPC (type-safe, inferido direto da API) |
| Ícones | [lucide-react](https://lucide.dev/) |
| Tema | next-themes (dark/light) |
| Notificações | [Sonner](https://sonner.emilkowal.ski/) |
| Lint/Format | Biome |
| Build | Vite |

## Estrutura de Diretórios

```
web/src/
├── app/
│   └── router.tsx             # Criação do TanStack Router com scrollRestoration
├── routes/                    # File-based routing (cada arquivo = uma rota)
│   ├── __root.tsx             # Layout raiz: QueryClient, ThemeProvider, ErrorBoundary, Toaster
│   ├── login.tsx              # Rota pública: login
│   ├── cadastro.tsx           # Rota pública: cadastro
│   ├── _protected.tsx         # Guard de autenticação (beforeLoad + getSession)
│   └── _protected/            # Rotas protegidas
│       ├── index.tsx          # Dashboard
│       ├── primeiro-acesso.tsx # Troca de senha obrigatória no primeiro acesso
│       ├── processos.tsx      # Layout da seção de processos
│       ├── processos.index.tsx # Lista de processos
│       ├── processos.novo.tsx  # Criação de processo
│       ├── processos.$processId.editar.tsx    # Edição de processo
│       ├── processos.$processId.checklist.tsx # Checklist documental
│       └── cadastros.tsx      # Página de administração (usuários e conjuntos)
├── features/                  # Código organizado por domínio
│   ├── auth/
│   ├── dashboard/
│   ├── processes/
│   └── admin/
└── shared/                    # Utilitários e componentes reutilizáveis
    ├── components/            # Componentes UI compartilhados
    ├── services/              # Configuração do cliente de API
    ├── config/                # Variáveis de ambiente do frontend
    ├── lib/                   # QueryClient, formatadores, helpers
    └── hooks/                 # Hooks genéricos (useDebounced, etc.)
```

## Padrão de Dados (3 arquivos por feature)

Cada feature segue obrigatoriamente esta separação:

```
*.service.ts   — chamadas HTTP puras via apiClient (sem estado React)
*.queries.ts   — queryOptions / infiniteQueryOptions com chaves hierárquicas
*.mutations.ts — useMutation hooks com invalidação automática de queries
```

### Fluxo completo

```
Componente
  └─ useQuery(processListOptions(query))          ← queries.ts
       └─ queryFn: () => listProcesses(query)     ← service.ts
            └─ apiClient.processes.$get(...)       ← Hono RPC Client
                 └─ GET /api/processes?...         ← API
```

```
Componente
  └─ useCreateProcess()                           ← mutations.ts
       └─ mutationFn: (data) => createProcess(data) ← service.ts
       └─ onSuccess: invalidate processKeys.lists() ← queries.ts
```

### Regras

- **Nunca** chamar service diretamente de um componente — sempre via hook de query/mutation
- **Nunca** usar `useState` para dados do servidor — usar React Query
- **Nunca** apontar o browser direto para a URL interna da API em produção — o acesso deve acontecer via mesma origem em `'/api/*'`
- Toda mutação deve invalidar as queries relacionadas em `onSuccess`

## Autenticação

O fluxo de auth roda no `beforeLoad` das rotas protegidas em `_protected.tsx`:

```typescript
// _protected.tsx
beforeLoad: async ({ location }) => {
  const session = await getSession()

  if (!session) {
    throw redirect({ to: '/login', search: { redirect: location.href } })
  }

  return {
    session: session.session,
    user: session.user,
  }
})
```

- `shouldReload: false` — a verificação de sessão roda **uma vez por sessão do navegador**, não em cada navegação
- O contexto da rota provê `{ session, user }` para todas as páginas protegidas
- Como o router usa `defaultPreload: 'intent'`, links que não devem pré-carregar auth devem usar `preload={false}`

### Cliente de API

```typescript
// shared/services/api-client.ts
export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl, {
    init: {
      credentials: 'include',
    },
  })
}
```

O `apiClient` é completamente type-safe: os tipos são inferidos das definições de rota do Hono. Se o contrato da API mudar, o TypeScript quebra na compilação do frontend.

### Proxy same-origin

- Em desenvolvimento, o navegador fala com `http://localhost:3555/api/*` e o Vite encaminha para `API_PROXY_TARGET` no servidor dev
- Em produção, o navegador fala com `https://<cloudfront>/api/*` e o CloudFront encaminha para a API
- `VITE_API_URL` deve apontar para a **origem pública do app web**, não para a API direta
- O cliente do better-auth usa essa origem pública e resolve automaticamente os endpoints em `'/api/auth/*'`

## Estrutura de Features

### `auth/`

Gerencia login, cadastro e primeiro acesso.

| Arquivo | Conteúdo |
|---------|---------|
| `auth-client.ts` | Cliente better-auth para o browser |
| `auth-session.ts` | `getSession()` — helper client-side para validar sessão atual |
| `login-page.tsx` | Formulário CPF + senha com redirect pós-login |
| `first-access-page.tsx` | Troca de senha obrigatória |
| `auth.roles.ts` | `getUserRoleLabel()` — mapeia role para texto em pt-BR |

### `dashboard/`

Painel com KPIs e gráficos agregados. Usa Recharts para visualizações.

| Componente | Descrição |
|-----------|-----------|
| `kpi-cards.tsx` | Cards de métricas (total, por status) |
| `status-distribution-chart.tsx` | Distribuição por status (pizza) |
| `owner-type-chart.tsx` | Breakdown por tipo de proprietário (barra) |
| `creation-timeline-chart.tsx` | Evolução de cadastros por período (linha) |
| `top-housing-complexes-chart.tsx` | Ranking de conjuntos habitacionais |
| `top-creators-chart.tsx` | Ranking de usuários por processos cadastrados |

### `processes/`

Módulo mais complexo. Cobre listagem, criação, edição, checklist documental e ações do fluxo processual.

**Serviços e queries:**

| Arquivo | Conteúdo |
|---------|---------|
| `processes.service.ts` | 20+ chamadas de API (CRUD, checklist, batch, PDF, histórico) |
| `processes.queries.ts` | Chaves hierárquicas + `queryOptions` para todas as entidades |
| `processes.mutations.ts` | 12 hooks de mutação com invalidação automática |

**Chaves de query:**

```typescript
processKeys = {
  all: ['processes'],
  lists: () => [...processKeys.all, 'list'],
  list: (query) => [...processKeys.lists(), query],
  detail: (id) => [...processKeys.all, 'detail', id],
  checklist: (id) => [...processKeys.detail(id), 'checklist'],
  batch: (id) => [...processKeys.detail(id), 'batch'],
  history: (id) => [...processKeys.detail(id), 'history'],
  pdfModels: (id) => [...processKeys.detail(id), 'pdf-models'],
}
```

**Componentes principais:**

| Componente | Descrição |
|-----------|-----------|
| `process-actions.tsx` | Dropdown contextual (ações variam por status e role) |
| `process-status-badge.tsx` | Badge colorido por status |
| `process-mobile-card.tsx` | Card para lista em mobile |
| `process-history-dialog.tsx` | Timeline com scroll infinito |
| `legal-process-dialog.tsx` | Modal para iniciar/editar dados jurídicos |
| `cancel-process-dialog.tsx` | Confirmação de cancelamento com motivo |
| `finalize-process-dialog.tsx` | Confirmação de finalização |
| `generate-pdf-dialog.tsx` | Seleção de modelo e geração de PDF |
| `process-checklist-item-card.tsx` | Card de um item do checklist documental |
| `process-checklist-item-dialog.tsx` | Modal para upload ou "OK sem arquivo" |
| `process-batch-section.tsx` | Upload e download de arquivos em lote |

### `admin/`

Interface de administração com duas abas: usuários e conjuntos habitacionais.

| Componente | Descrição |
|-----------|-----------|
| `create-user-modal.tsx` | Formulário de criação de usuário |
| `edit-user-dialog.tsx` | Edição de dados do usuário |
| `reset-user-dialog.tsx` | Reset de conta + senha temporária |
| `create-housing-complex-dialog.tsx` | Criar conjunto habitacional |
| `edit-housing-complex-dialog.tsx` | Editar conjunto |
| `delete-housing-complex-dialog.tsx` | Confirmar exclusão |

## Componentes Compartilhados

### Layout

```
authenticated-layout/
├── authenticated-layout.tsx      # Container principal com sidebar + header + content
├── authenticated-sidebar.tsx     # Navegação lateral (collapsible="icon")
├── authenticated-header.tsx      # Topo com menu do usuário
└── authenticated-theme-switcher.tsx # Toggle dark/light
```

### UI Compartilhada (`shared/components/`)

| Componente | Uso |
|-----------|-----|
| `AppDialog` | **Sempre** usar ao invés de primitivos Dialog diretos |
| `PageHeader` | Cabeçalho de página com título, descrição e ações |
| `SearchInput` | Input de busca com ícone integrado |
| `StatusBadge` | Badge colorido por tone (`success`, `warning`, `info`, `error`, `ghost`) |
| `SearchableSelect` | Combobox com busca para dropdowns |
| `PasswordInput` | Campo de senha com toggle show/hide |
| `ConfirmDialog` | Dialog de confirmação genérico |
| `QueryError` | Estado de erro para queries com botão de retry |
| `ErrorBoundary` | Captura erros React com botão de reload |
| `SettingsLayout` | Sidebar mini + conteúdo para páginas admin |
| `DataTable` | Tabela responsiva (cards em mobile, tabela no desktop) |

### AppDialog — uso correto

```tsx
<AppDialog
  icon={Gavel}              // LucideIcon
  variant="info"            // default | info | success | warning | destructive
  title="Título do dialog"
  description="Descrição opcional"
  maxWidth="2xl"            // sm | md | lg | xl | 2xl | 3xl
  open={isOpen}
  onClose={() => setIsOpen(false)}
  footer={<Button>Ação</Button>}
>
  {children}
</AppDialog>
```

### DataTable — uso correto

Sempre envolver em Card com overflow configurado:

```tsx
<Card className="overflow-hidden">
  <CardContent className="overflow-x-auto px-0 sm:px-0">
    <DataTable columns={columns} data={data} />
  </CardContent>
</Card>
```

A tabela exibe cards abaixo de `xl` e tabela acima de `xl` automaticamente.

## Formulários

Use o hook `useZodForm` que combina react-hook-form + Zod:

```typescript
// shared/components/ui/form/use-zod-form.ts
const form = useZodForm({
  schema: createProcessSchema,
  defaultValues: { fullName: '' },
})
```

Use os componentes `FormField`, `FormInput`, `FormSelect`, `FormTextarea` ao invés de compor do zero — eles já integram com react-hook-form e exibem erros automaticamente.

## Tratamento de Erros

### Erros de query

Use `QueryError` para exibir estado de erro com retry:

```tsx
if (query.isError) return <QueryError onRetry={query.refetch} />
```

### Erros de mutação

O `MutationCache` global em `shared/lib/query-client.ts` exibe um toast automaticamente para **qualquer** mutação que falhe. Não é necessário adicionar `onError` em cada mutação.

### Erros inesperados

O `ErrorBoundary` em `__root.tsx` captura erros de renderização React e exibe uma tela de reload.

## Convenções de Nomenclatura

### Arquivos

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Página | `feature-name-page.tsx` | `processes-page.tsx` |
| Componente | `component-name.tsx` | `process-status-badge.tsx` |
| Serviço | `feature-name.service.ts` | `processes.service.ts` |
| Queries | `feature-name.queries.ts` | `processes.queries.ts` |
| Mutations | `feature-name.mutations.ts` | `processes.mutations.ts` |
| Schema Zod | `feature-name.schema.ts` | `auth.schema.ts` |

### Código

| Elemento | Padrão | Exemplo |
|---------|--------|---------|
| Query keys | `featureKeys.all`, `featureKeys.lists()`, `featureKeys.detail(id)` | `processKeys.detail(id)` |
| Mutation hooks | `useCreateFeature`, `useUpdateFeature`, `useDeleteFeature` | `useCreateProcess()` |
| Status tones | `success`, `warning`, `info`, `error`, `ghost` | `tone="success"` |

### Texto e UI

- Todo texto visível ao usuário em **português (pt-BR)** — sem `.toUpperCase()` em labels
- Sem classes CSS `uppercase tracking-[*]` em texto de conteúdo
- Botões: `<Button>` shadcn com tamanho padrão `h-9`
- Inputs: `<Input>` shadcn com altura `h-9`
- Links de navegação: `<Link className="no-underline" preload={false}>`
- Links dentro de dropdowns: sempre `preload={false}`
- Links da navegação autenticada que não precisam pré-carregar rota também devem preferir `preload={false}` para evitar chamadas extras de sessão em hover

### Aliases de importação

| Alias | Resolução |
|-------|-----------|
| `@/` | `src/` — código da feature e shared |
| `#/` | `src/` — componentes shadcn (gerados automaticamente) |
| `@api/` | `../api/src/` — tipos da API via Hono RPC |

## Comandos

```bash
bun run dev         # Inicia servidor Vite de desenvolvimento
bun run build       # Build de produção
bun run typecheck   # Checagem TypeScript
bun run lint        # Biome lint
bun run format      # Biome format
```

## Variáveis de Ambiente

| Variável | Uso |
|---------|-----|
| `VITE_API_URL` | Origem pública do app web usada pelo cliente HTTP (`http://localhost:3555` no local) |
| `API_PROXY_TARGET` | Somente dev. Endereço real da API que o Vite deve proxiar (`http://localhost:3556`) |

## Como Contribuir

### Adicionando uma nova página

1. Crie o arquivo de rota em `src/routes/` seguindo a convenção do TanStack Router:
   - `_protected/minha-pagina.tsx` para rotas simples
   - `_protected/minha-secao.tsx` + `_protected/minha-secao.index.tsx` para layouts com sub-rotas
2. Crie a pasta `src/features/minha-feature/`
3. Implemente os 3 arquivos obrigatórios:
   - `minha-feature.service.ts` — chamadas `apiClient`
   - `minha-feature.queries.ts` — `queryOptions` com chaves hierárquicas
   - `minha-feature.mutations.ts` — hooks `useMutation` com invalidação
4. Crie a página em `minha-feature-page.tsx`

### Adicionando um componente

1. Se for reutilizável em múltiplas features: `src/shared/components/`
2. Se for específico de uma feature: `src/features/minha-feature/components/`
3. Nunca criar componentes para uso único em um único lugar — inline ou extrair para feature

### Adicionando uma mutation

```typescript
// minha-feature.mutations.ts
export function useCreateMinhaFeature() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateInput) => createMinhaFeature(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: minhaFeatureKeys.lists() })
    },
    // onError: não é necessário — o MutationCache global já exibe toast
  })
}
```

### Checklist antes do PR

- [ ] `bun run typecheck` passa sem erros
- [ ] `bun run lint` passa sem warnings
- [ ] Sem `useState` para dados do servidor — usar React Query
- [ ] Sem chamadas de service direto no componente — usar hooks de query/mutation
- [ ] Todo texto visível em pt-BR
- [ ] Dialogs usando `AppDialog`, não primitivos Dialog
- [ ] Tabelas usando o padrão `Card > CardContent > DataTable`
