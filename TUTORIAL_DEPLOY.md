# Deploy no Prisma Compute — passo a passo (VS Code)

Este projeto já está com o schema, o cliente Prisma e um servidor Hono/Bun
mínimo prontos. Siga os passos abaixo dentro do VS Code.

## 0. Pré-requisitos

- **Bun** instalado (`bun --version`). Se não tiver: `curl -fsSL https://bun.sh/install | bash`.
- Terminal integrado do VS Code aberto na raiz do projeto (`` Ctrl+` `` ou `Cmd+J`).

## 1. Abrir o projeto e instalar dependências

No terminal integrado do VS Code:

```bash
cd discord-clone-app
bun install
```

## 2. Configurar o banco de dados

```bash
cp .env.example .env
```

Abra o `.env` no VS Code e cole a `DATABASE_URL` real do seu banco Postgres
(pode ser um Prisma Postgres, Neon, Supabase, RDS — qualquer Postgres serve).

## 3. Gerar o Prisma Client e rodar a primeira migração

```bash
bun run db:generate
bun run db:migrate:dev
```

O comando `migrate dev` vai perguntar um nome para a migração (ex: `init`) e
criar as tabelas no banco a partir do `prisma/schema.prisma`.

> Dica: use a extensão oficial **Prisma** no VS Code (marketplace: `Prisma.prisma`)
> para ter syntax highlighting e autocomplete no `schema.prisma`.

## 4. Testar localmente antes de fazer deploy

```bash
bun run dev
```

Abra `http://localhost:3000` no navegador (ou use a extensão **Thunder Client** /
**REST Client** do VS Code) — deve responder `{ "status": "ok", ... }`.
Teste também `http://localhost:3000/servers`.

Pare o servidor com `Ctrl+C` antes de seguir.

## 5. Autenticar no Prisma CLI

```bash
bunx @prisma/cli@latest auth login
```

Isso abre uma aba do navegador para login/autorização. Depois de autorizar,
volte ao VS Code — o terminal confirma a sessão. Você pode checar a qualquer
momento com:

```bash
bunx @prisma/cli@latest auth whoami
```

## 6. Deploy para o projeto já existente ("Passionate Orange Chameleon")

Como você já tem um projeto criado (`proj_cmt6lrih516p81gf6w9htdp56`, região
`us-east-1`), rode o deploy apontando para ele e passando o `.env` para que a
`DATABASE_URL` seja levada para produção:

```bash
bunx @prisma/cli@latest app deploy --project proj_cmt6lrih516p81gf6w9htdp56 --env .env
```

Na primeira vez, isso:
- vincula esta pasta ao projeto (fica salvo em `.prisma/local.json`, que é ignorado pelo git — não precisa versionar);
- builda o app localmente e faz upload;
- promove para produção automaticamente no primeiro deploy.

Ao final, o terminal mostra algo como:

```
Live in 8.2s https://<seu-app>.ewr.prisma.build
```

Teste a URL real:

```bash
curl https://<seu-app>.ewr.prisma.build/servers
```

## 7. Rodar as migrações contra o banco de produção

Se o `DATABASE_URL` de produção for diferente do seu `.env` local, aponte a
migração para o banco certo antes de rodar (use um `.env.production` separado
se preferir, e passe `--env .env.production` no passo 6 também):

```bash
bunx @prisma/cli migrate deploy
```

`migrate deploy` (diferente de `migrate dev`) só aplica migrações pendentes —
é o comando seguro para produção, não cria migrações novas nem pede confirmação interativa.

## 8. (Opcional) Deploy automático a cada push

Se este projeto estiver num repositório GitHub, você pode conectar o branch
para que todo `git push` dispare um deploy sozinho — sem precisar rodar o
comando manualmente de novo:

```bash
bunx @prisma/cli@latest app connect
```

Siga o prompt para escolher o repositório e o branch (`main` = produção,
outros branches = preview com URL isolada).

## Resumo dos comandos, em ordem

```bash
bun install
cp .env.example .env               # editar DATABASE_URL
bun run db:generate
bun run db:migrate:dev
bun run dev                        # testar local, depois Ctrl+C
bunx @prisma/cli@latest auth login
bunx @prisma/cli@latest app deploy --project proj_cmt6lrih516p81gf6w9htdp56 --env .env
bunx @prisma/cli migrate deploy
```

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `auth whoami` diz "not signed in" após login | Sessão não persistiu | Rode `auth login` de novo; confira que o navegador concluiu o fluxo de autorização |
| Deploy funciona mas URL retorna erro 5xx | App não sobe na porta esperada | Confirme que `src/index.ts` lê `process.env.PORT` (já está assim neste scaffold) |
| `/servers` retorna array vazio | Banco de produção diferente do local, sem dados | Rode `db:migrate` contra o banco certo e confira se há dados nele |
| `P1001: Can't reach database server` | `DATABASE_URL` errada ou banco não aceita conexão externa | Revise host/porta/credenciais e regras de firewall do provedor do banco |
