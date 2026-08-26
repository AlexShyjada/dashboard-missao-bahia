# Dashboard da Base de candidatos — Missão Bahia

Página pública que lê a base do Notion em tempo real e mostra a progressão das
seis etapas da operação: **Já ligou**, **Aceitou Fundão**, **Material de campanha**,
**Confeccionado na gráfica**, **Pagamento** e **Certificado de doação**.

Roda como um único Cloudflare Worker: ele serve a página e, na mesma origem,
expõe `/api/stats`. Toda consulta ao Notion acontece no servidor.

- O token do Notion fica como *secret* no Cloudflare. Ele nunca chega ao navegador.
- A resposta da API carrega **apenas contagens agregadas**. Nome, telefone,
  WhatsApp, documentos e qualquer outro dado de candidato ficam no Notion.
- A página consulta a cada carregamento, a cada 45 segundos com a aba aberta e
  quando você volta para a aba. Há um cache de 15 segundos na borda para não
  estourar o limite de 3 requisições por segundo do Notion.

---

## Deploy passo a passo

Você precisa de Node.js 18+ instalado e de uma conta Cloudflare (o plano gratuito
cobre isso com folga).

### 1. Criar a integração no Notion

1. Acesse <https://www.notion.so/profile/integrations> e clique em **New integration**.
2. Nome: `Dashboard Missão Bahia`. Workspace: `missao-bahia`.
3. Em capabilities, deixe apenas **Read content**. O dashboard só lê.
4. Copie o **Internal Integration Secret** (começa com `ntn_`). Guarde num lugar seguro.

### 2. Dar acesso à base

1. Abra a página **Base de candidatos** no Notion.
2. Menu `···` no canto superior direito → **Conexões** (ou *Connections*) → **Adicionar conexões**.
3. Escolha `Dashboard Missão Bahia` e confirme.

Sem esse passo a API responde 404, mesmo com o token certo.

### 3. Conferir o ID da base

O `NOTION_DATABASE_ID` já está preenchido no `wrangler.toml` com o ID que veio da
URL da sua base:

```
https://www.notion.so/missao-bahia/3c14f290d5c480d7b649ee415cf17433?v=...
                                   └──────── esse trecho ────────┘
```

Se algum dia a base mudar, é só trocar esse valor.

### 4. Publicar

```bash
npm install
npx wrangler login          # abre o navegador para autorizar sua conta Cloudflare
npx wrangler secret put NOTION_TOKEN
# cole o token ntn_... quando for pedido e dê Enter
npx wrangler deploy
```

O deploy imprime a URL final, algo como:

```
https://missao-bahia-dashboard.SEU-SUBDOMINIO.workers.dev
```

Esse é o link que você manda para a equipe. Abre em qualquer navegador, sem login.

### 5. Rodar local (opcional)

```bash
cp .dev.vars.example .dev.vars   # cole o token dentro
npx wrangler dev
```

---

## Ajustes que você provavelmente vai querer fazer

### Renomeei uma coluna no Notion

Abra `src/worker.js` e ajuste a lista `STAGES`. Cada etapa tem um `property`
(o nome exato) e `aliases` (nomes alternativos). O casamento já ignora acentos,
maiúsculas e pontuação, e tolera o typo atual `Confecionado` com um `c` só.

### Quero mudar quais valores contam como concluído

Edite `DONE_VALUES` e `NA_VALUES` no `wrangler.toml` e rode `npx wrangler deploy`
de novo. Qualquer valor que não esteja em nenhuma das duas listas é tratado como
pendente, e aparece no gráfico com o nome que tem no Notion.

`NA_VALUES` sai do denominador: as 7 mulheres marcadas como "Não precisa" no
certificado de doação não puxam o percentual da etapa para baixo.

### Quero que atualize mais rápido

`REFRESH_MS` em `public/index.html` (padrão 45s) e `EDGE_TTL_SECONDS` em
`src/worker.js` (padrão 15s). Não desça muito do cache de borda: o Notion limita
a média de 3 requisições por segundo por integração, e cada carga do dashboard
gasta 2 mais uma por página de 100 candidatos.

### Quero restringir quem acessa

Como está, qualquer pessoa com o link vê os números agregados. Se quiser fechar,
o caminho é **Cloudflare Zero Trust → Access → Applications**, criando uma
aplicação self-hosted apontando para o domínio do Worker, com login por e-mail.
O plano gratuito cobre até 50 usuários.

---

## Testes

```bash
npm test
```

Cobre a agregação: contagem por etapa, exclusão de "Não precisa" do denominador,
tratamento de células vazias, o casamento do nome da coluna com o typo corrigido
e a leitura de colunas do tipo checkbox, files e select.

## Estrutura

```
src/worker.js       consulta o Notion e agrega (endpoint /api/stats)
public/index.html   a página inteira, sem dependências externas
test/               testes da agregação e captura de tela do layout
wrangler.toml       configuração e variáveis públicas
```
