# Trabalhando com múltiplas sessões do Claude (worktrees)

Várias sessões na **mesma pasta** compartilham o `.git/index` — aí o `git commit`
de uma sessão arrasta o que outra deixou em _staging_. Para evitar isso, **cada
sessão usa sua própria worktree** (pasta + index próprios, histórico compartilhado).

## Criar uma worktree por frente de trabalho

```powershell
cd c:\jurisflow_web\jurisflow
git fetch origin
git worktree add ..\wt-<nome> -b feat/<nome> origin/dev
git worktree list
```

Abra a sessão do Claude **na pasta da worktree** (ex.: `c:\jurisflow_web\wt-<nome>`).

## Validar (typecheck/lint) na worktree — usa o Bun do host

`node_modules` não é compartilhado entre worktrees; instale uma vez:

```powershell
cd ..\wt-<nome>\api ; bun install
cd ..\web ; bun install
# a cada mudança:
bun run typecheck ; bun run lint
```

## Rodar o app (Docker)

O `compose.yml` usa portas fixas e o nome do projeto vem da pasta — **dois stacks
colidem**. Duas opções:

- **Recomendado:** só **um** stack "líder" roda o app (a pasta principal). As
  worktrees ficam em código + typecheck/lint.
- **Dois apps ao mesmo tempo:** copie `compose.override.example.yml` para a
  worktree como `compose.override.yml`, defina `COMPOSE_PROJECT_NAME` e suba:

  ```powershell
  $env:COMPOSE_PROJECT_NAME = "jurisflow-<nome>"
  docker compose up -d   # web em http://localhost:3565
  ```

## Encerrar uma worktree

```powershell
git worktree remove ..\wt-<nome>     # remove a pasta (a branch permanece)
```

## Regras que evitam o problema

1. **Uma branch por sessão** — nunca duas sessões na mesma branch.
2. **`git add <caminhos>` explícito** — nunca `git add -A`/`.` em pasta compartilhada.
   (Em pasta compartilhada, prefira `git commit -- <caminhos>` para commitar só o seu.)
3. **`git pull --rebase origin dev`** antes de começar; commits pequenos e frequentes.
4. **Integrar via PR para `dev`** (uma branch por frente).
