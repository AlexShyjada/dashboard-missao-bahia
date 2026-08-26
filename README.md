# Dashboard da Base de candidatos — Missão Bahia

Página pública que lê a base do Notion e mostra a progressão da operação.
Hospedada na Netlify: a pasta `public/` é servida como está, e uma Netlify
Function responde em `/api/stats`.

## Deploy na Netlify

O repositório já está no GitHub, então é só conectar.

### 1. Criar a integração no Notion

1. Vá em <https://www.notion.so/profile/integrations> → **New integration**.
2. Em capabilities, deixe só **Read content**.
3. Copie o **Internal Integration Secret** (começa com `ntn_`).

### 2. Dar acesso à base

Abra a base no Notion → menu `···` no canto superior direito → **Conexões** →
**Adicionar conexões** → escolha a integração criada no passo 1.

Sem esse passo a API responde 404, mesmo com o token correto.

### 3. Conectar o repositório

Em <https://app.netlify.com> → **Add new site** → **Import an existing project**
→ **GitHub** → escolha este repositório.

As configurações de build já vêm do `netlify.toml`, não precisa preencher nada:

| Campo | Valor |
|---|---|
| Build command | *(vazio)* |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

### 4. Colocar o token

Depois do primeiro deploy, em **Site configuration → Environment variables →
Add a variable**:

- Key: `NOTION_TOKEN`
- Value: o token `ntn_...`
- Marque como **Secret** (some dos logs de build)
- Scope: **Functions**

Rode um novo deploy (**Deploys → Trigger deploy → Deploy site**) para a função
enxergar a variável.

Pronto. A URL que a Netlify gerar é o link que você manda para a equipe: abre em
qualquer navegador, sem login.

### 5. Rodar local (opcional)

```bash
npm install -g netlify-cli
cp .env.example .env      # cole o token dentro
netlify dev
```
