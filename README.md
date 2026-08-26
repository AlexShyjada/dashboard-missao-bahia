# Dashboard da Base de candidatos — Missão Bahia

Página pública que lê a base do Notion e mostra a progressão das seis etapas da
operação: **Já ligou**, **Aceitou Fundão**, **Material de campanha**,
**Confeccionado na gráfica**, **Pagamento** e **Certificado de doação**.

Hospedado na Netlify: a pasta `public/` é servida como está, e uma Netlify
Function responde em `/api/stats`. Toda conversa com o Notion acontece no
servidor.

- O token do Notion vive numa variável de ambiente da Netlify. Ele nunca entra
  no repositório nem chega ao navegador de quem abre o dashboard.
- A resposta da API carrega **apenas contagens agregadas**. Nome, telefone,
  WhatsApp, número de campanha e documentos ficam no Notion.

---

## Deploy na Netlify

O repositório já está no GitHub, então é só conectar.

### 1. Criar a integração no Notion

1. Vá em <https://www.notion.so/profile/integrations> → **New integration**.
2. Nome: `Dashboard Missão Bahia`. Workspace: `missao-bahia`.
3. Em capabilities, deixe só **Read content**. O dashboard não escreve nada.
4. Copie o **Internal Integration Secret** (começa com `ntn_`).

### 2. Dar acesso à base

Abra a página **Base de candidatos** no Notion → menu `···` no canto superior
direito → **Conexões** → **Adicionar conexões** → escolha `Dashboard Missão Bahia`.

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

---

## O limite da Netlify, e por que o código se comporta assim

O plano gratuito dá **125 mil invocações de função por mês**, e quando estoura
**o site é suspenso até o fim do mês**. Num dashboard de campanha, isso é o pior
momento possível para sair do ar, então a página foi feita para não chegar perto.

Três mecanismos seguram a conta:

1. **Cache de 20 segundos no CDN**, com o diretivo `durable`. Um nó de borda
   reaproveita o que outro já buscou, então dez pessoas olhando ao mesmo tempo
   custam o mesmo que uma.
2. **A varredura para quando a aba não está visível.** Laptop fechado, aba em
   segundo plano: zero requisição.
3. **Desaceleração por ociosidade.** Com alguém mexendo, a página varre a cada
   30 segundos. Depois de 5 minutos sem nenhum toque, cai para 3 minutos e o
   indicador passa a mostrar "em espera". O primeiro clique, tecla ou rolagem
   devolve o ritmo e busca na hora.

Na prática:

| Cenário | Invocações/mês |
|---|---|
| Aba esquecida aberta num monitor, 24h por dia | ~14 mil |
| Equipe usando ativamente 8h por dia útil | ~40 mil |
| Limite do plano gratuito | 125 mil |

O teste `test/polling.test.mjs` mede essa cadência com relógio controlado, para
a conta não virar suposição.

---

## Sobre "tempo real"

É pull, não push. A página pergunta; ninguém empurra a mudança para ela.

Quem marca "Feito" no Notion aparece na tela na próxima varredura. Somando o
cache do CDN, **o número tem no máximo uns 50 segundos de atraso em uso ativo**.
O botão **Atualizar** pula o cache e lê o Notion na hora, em 1 a 2 segundos, com
5 segundos de cooldown para a equipe inteira não bater no Notion junto.

Webhook do Notion não ajudaria: o evento `page.properties_updated` é agregado e a
própria Notion promete entrega "em até 5 minutos, a maioria em até 1 minuto".
Seria mais lento que a varredura atual, com muito mais peça para dar defeito.

---

## Ajustes

### Renomearam uma coluna no Notion

Ajuste a lista `STAGES` em `src/notion.js`. Cada etapa tem um `property` (o nome
exato) e `aliases`. O casamento ignora acentos, maiúsculas e pontuação, e já
tolera o typo atual `Confecionado` com um `c` só.

### Mudar o que conta como concluído

Variáveis `DONE_VALUES` e `NA_VALUES` (na Netlify, ou os padrões em
`src/config.js`). Qualquer valor fora das duas listas conta como pendente e
aparece no gráfico com o nome que tem no Notion.

`NA_VALUES` sai do denominador: quem está como "Não precisa" no certificado de
doação não puxa o percentual da etapa para baixo.

### Mudar a cadência

`ACTIVE_MS`, `IDLE_MS` e `IDLE_AFTER_MS` em `public/index.html`;
`EDGE_TTL_SECONDS` em `src/config.js` ou nas variáveis da Netlify. Se apertar,
refaça a conta da tabela acima.

### Restringir quem acessa

Como está, qualquer pessoa com o link vê os números agregados. Para fechar por
e-mail, o caminho é **Netlify Identity** ou pôr o site atrás do Cloudflare Access.

---

## Segurança

O token não está em lugar nenhum deste repositório, e `.gitignore` cobre `.env`
e `.dev.vars`. Se em algum momento ele foi comitado, mesmo que depois removido,
**considere o token queimado**: revogue em notion.so/profile/integrations, gere
outro e atualize a variável na Netlify. O histórico do git guarda o valor antigo.

---

## Testes

```bash
npm test
```

Três suítes:

- `aggregate.test.mjs` — agregação: contagem por etapa, exclusão de "Não precisa"
  do denominador, células vazias, casamento do nome da coluna com o typo
  corrigido, leitura de checkbox / files / select.
- `handlers.test.mjs` — os dois adaptadores contra uma API do Notion simulada:
  paginação de 150 candidatos, cabeçalhos de cache, `?fresh=1` e os erros
  prováveis (sem token, base sem acesso).
- `polling.test.mjs` — a cadência na página real, com relógio controlado.

## Estrutura

```
src/notion.js               núcleo: fala com o Notion e agrega (não conhece host)
src/config.js               configuração e padrões
netlify/functions/stats.mjs adaptador Netlify — rota /api/stats
src/worker.js               adaptador Cloudflare Workers (alternativa, npx wrangler deploy)
public/index.html           a página inteira, sem dependências externas
netlify.toml                configuração da Netlify
wrangler.toml               configuração da Cloudflare
test/                       as três suítes acima
```
