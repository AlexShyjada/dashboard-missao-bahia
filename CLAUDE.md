# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Todo o código, comentários, mensagens de erro e commits deste projeto são em
português do Brasil. Escreva em português ao editar este repositório.

## O que é e por quê

Dashboard público que lê uma base do Notion e mostra a progressão das etapas
operacionais de uma campanha eleitoral (Missão Bahia). Página estática servida
pela Netlify, com uma Netlify Function fazendo a ponte com o Notion.

A operação acompanha ~21 candidatos numa base do Notion com 26 colunas. Saber
"onde a campanha está travada" exigia abrir o Notion e ler a tabela coluna por
coluna. O dashboard responde isso de relance, num link que a equipe inteira abre
sem login.

Requisitos fixados pelo usuário, em ordem de importância — relevantes para
qualquer mudança futura:

1. **Link público, sem login.** A equipe não tem conta em nada. Isso descartou
   o artifact do claude.ai (que trava no dono) e obrigou hospedagem própria.
2. **Atualiza a cada carregamento.** Não pode ser snapshot regenerado à mão.
3. **Nenhum dado pessoal na resposta da API** (ver "Privacidade").
4. **Sem recortes por cidade ou cargo.** Só a progressão das etapas.
5. Os rótulos na tela imitam a notação que já existe nas colunas do Notion.

## Comandos

```bash
npm test        # roda as três suítes (node puro, sem framework de teste)
npm run dev     # netlify dev — servidor local incl. a function, precisa de .env com NOTION_TOKEN
npm run shot    # test/shot.mjs — renderiza public/index.html com Playwright contra payload fake, screenshots em /tmp
```

Para rodar uma suíte isolada: `node test/aggregate.test.mjs` (cada arquivo é um
script `.mjs` com asserts próprios, sai com código não-zero ao falhar). Não há
build nem lint — `public/` é servido como está.

## Arquitetura

```
public/index.html            a página inteira: HTML + CSS + JS, zero dependência externa
netlify/functions/stats.mjs  adaptador Netlify — responde em /api/stats
src/notion.js                núcleo: fala com a API do Notion e agrega (não conhece host)
src/config.js                configuração e padrões (o único segredo vem do ambiente)
src/worker.js                adaptador Cloudflare Workers — alternativa, mesmo núcleo
netlify.toml / wrangler.toml configuração de cada host
test/                        três suítes (ver "Testes")
```

O núcleo é deliberadamente agnóstico de host. Os adaptadores só cuidam de rota,
cache e formato de erro. Se aparecer um terceiro host, escreve-se outro
adaptador de ~40 linhas.

### Fluxo de uma requisição

1. `GET /api/stats` chega na Netlify Function.
2. `resolveDataSource()` chama `GET /v1/databases/{id}` e pega a primeira
   `data_sources[]`. Obrigatório na versão 2025-09-03 da API: a consulta não
   acontece mais na database, e sim na data source.
3. `GET /v1/data_sources/{id}` traz o schema (nomes e opções das colunas).
4. `POST /v1/data_sources/{id}/query` pagina de 100 em 100, teto de 40 páginas.
5. `buildStats()` agrega e devolve só contagens.

## A base no Notion

- Database ID: `3c14f290d5c480d7b649ee415cf17433` (default em `src/config.js`)
- Workspace: `missao-bahia`
- ~21 candidatos, todos "Deputado Federal", cidades espalhadas pela Bahia

`Confecionado na gráfica?` está grafada com um `c` só. É typo da base, não do
código. `matchProperty()` tolera: casa por igualdade normalizada (sem acento,
caixa ou pontuação), depois por conteúdo, depois por sobreposição de palavras, e
cada etapa tem `aliases` cobrindo a grafia corrigida. Se alguém arrumar o typo
no Notion, nada quebra.

## Classificação — a parte que mais custou a acertar

Cada valor cai em um de cinco estados: `done`, `partial`, `pending`, `na`,
`empty`. A ordem é fixa e define tanto o cálculo quanto a ordem visual dos
segmentos na barra.

Revisada com o usuário em 26/08/2026, coluna por coluna:

| # | Coluna | Não iniciado | Intermediário | Concluído | Fora da conta |
|---|---|---|---|---|---|
| 1 | `Já ligou?` | Não | — | **Sim** | — |
| 2 | `Já fez a procuração Advogado?` | Pendente | Feito | **Assinado** | — |
| 3 | `Já foi feito o Material?` | Pendente | — | **Feito** | — |
| 4 | `Confecionado na gráfica?` | Pendente | — | **Feito** | — |
| 5 | `Já foi Pago?` | Pendente | — | **Feito** | — |
| 6 | `Certificado de doação (Homens)` | Pendente | Feito | **Assinado** | Não precisa |
| — | `Aceitou Fundão?` | — | — | — | a etapa inteira |

### O degrau de assinatura

Numa coluna de documento, `Feito` **não** é concluído. Significa documento
confeccionado, ainda sem assinatura. Só `Assinado` fecha a etapa e entra no
percentual. `Feito` vira `partial`: azul na barra (trocado do verde claro
original em 26/08/2026 — a pedido do usuário, para não ler como "quase
concluído"), mais uma linha no card dizendo quantos estão prontos esperando
assinatura.

Isso é detectado por coluna, em tempo de execução, nunca por lista codificada:
se a coluna oferece algum valor de `SIGNED_VALUES`, ela é documento. Se não
oferece, `Feito` continua sendo o fim da linha. Criar a opção `Assinado` numa
coluna do Notion muda o comportamento sem redeploy.

Esse detalhe mudou a leitura da operação. Somando `Feito` com `Assinado`,
parecia que a campanha estava travada na produção. Separando, viu-se que a
produção andou (14 das 21 procurações confeccionadas) e o que não anda é a
coleta de assinatura — ações operacionais diferentes. Por isso o topo da
página mostra "N documentos esperando assinatura": é o número que muda o que a
equipe faz.

### Outras regras

- `NA_VALUES` sai do denominador. As 7 mulheres marcadas "Não precisa" no
  certificado não puxam o percentual da etapa para baixo (a etapa lê `x/14`).
- Célula vazia vira o bucket próprio `Sem preenchimento`, conta como pendente e
  aparece na tela. Nunca some silenciosamente.
- `Aceitou Fundão?` é marcador de entrada, não tarefa: é a flag
  `excludeFromOverall: true` em `STAGES`, e por isso fica fora do percentual
  geral. Removida a exibição como card na tela a pedido do usuário
  (26/08/2026) — `orderedStages()` em `public/index.html` já filtra
  `excludeFromOverall` antes de renderizar cards e gráfico, então a etapa
  segue existindo nos dados sem aparecer na página.
- "Não" em `Já ligou?` é não-iniciado, não é recusa (confirmado com o
  usuário). Ninguém sai do denominador por ter dito não.
- A ordem dos segmentos é sempre `done → partial → pending → empty → na`,
  ignorando a ordem das opções no Notion, que varia por coluna. Sem isso o
  verde abria à esquerda num card e à direita no outro, e ficava impossível
  comparar as seis barras de relance.

## O limite da Netlify — restrição de projeto, não detalhe

Plano gratuito: 125 mil invocações de função por mês, e ao estourar o site é
suspenso até o fim do mês. Para um dashboard de campanha, sair do ar é o pior
resultado possível. Três mecanismos seguram a conta:

1. Cache de 20s no CDN com o diretivo `durable`
   (`Netlify-CDN-Cache-Control`). Um nó de borda reaproveita o que outro
   buscou: dez pessoas custam como uma. `Netlify-Vary: query=fresh` separa a
   entrada do `?fresh=1`.
2. A varredura para com a aba escondida (`visibilityState`).
3. Desaceleração por ociosidade: 30s com alguém mexendo, 3 min depois de
   5 min sem toque. O primeiro clique ou tecla retoma e busca na hora.

Orçamento medido: aba esquecida 24h/dia ≈ 14 mil/mês; equipe usando 8h/dia
útil ≈ 40 mil/mês. `test/polling.test.mjs` mede isso com relógio controlado,
para a conta não virar suposição.

**Antes de mexer em `ACTIVE_MS`, `IDLE_MS` ou `EDGE_TTL_SECONDS`, refaça a
conta.**

### Não é tempo real, é pull

Atraso máximo de ~50s em uso ativo. O botão Atualizar manda `?fresh=1`, pula o
cache e lê o Notion em 1-2s, com 5s de cooldown por usuário.

Webhook do Notion não ajudaria — já foi investigado. O evento
`page.properties_updated` é agregado e a Notion promete entrega "em até 5
minutos, a maioria em até 1 minuto". Mais lento que a varredura atual, com
mais peça para dar defeito. **Não reabrir essa discussão sem dado novo.**

Limite do Notion: média de 3 req/s por integração. Cada leitura completa gasta
3 chamadas (database + data source + 1 por página de 100).

## Privacidade

`/api/stats` devolve apenas contagens agregadas. Nome, WhatsApp, número de
campanha, cidade, gênero e os PDFs nunca saem do servidor. Isso é deliberado:
o link é público, então se alguém repassar a URL o que vaza é "8 de 21 já
ligaram", nunca a lista de candidatos.

**Ao adicionar qualquer campo à resposta da API, verificar se ele é
agregado.**

O `NOTION_TOKEN` vive só na variável de ambiente da Netlify. Não está no
repositório; `.gitignore` cobre `.env` e `.dev.vars`. A integração do Notion
tem permissão de leitura apenas.

## Design da página

Segue a metodologia da skill `dataviz`. O que não é óbvio:

- Paleta de status, não categórica: `good #0ca30c`, `warning #fab219`,
  neutros `#898781` / `#c3c2b7`. O intermediário (documento pronto, aguardando
  assinatura) é azul (`#2a78d6` claro / `#3987e5` escuro — mesma família do
  `--accent`), trocado do verde claro original em 26/08/2026 a pedido do
  usuário: verde clareado lia como "quase concluído", o que não é o caso.
  Validada (separação CVD e piso de visão normal) com o validador da skill
  `dataviz` nos dois modos — não há script de validação dentro deste
  repositório.
- Cor nunca carrega significado sozinha. O amarelo de "Pendente" fica abaixo
  de 3:1 no fundo claro; a mitigação é ícone + rótulo + contagem em toda
  legenda. Se mexer nas cores, manter os ícones.
- Barras ≤ 18px, gap de 2px entre segmentos (nunca borda), cantos 4px nas
  pontas.
- Tema claro e escuro, ambos escolhidos passo a passo, não invertidos.
- Sem dependência externa: uma página, um arquivo, nada de CDN.

Dois blocos de visualização, ambos em `public/index.html`:

- **Cards por etapa** (`renderCards` / `.card`): barra empilhada por status
  (`done`/`partial`/`pending`/`na`/`empty`), cor categórica de status — o
  detalhamento por etapa.
- **Comparação entre etapas** (`renderChart` / `.chart`): um gráfico de
  barras horizontais, uma por etapa, todas na mesma cor (`--accent`) porque é
  uma única medida (% concluído) comparada entre categorias — não uma
  identidade a distinguir. Tem grade e eixo em 0/25/50/75/100% e tooltip por
  barra (reaproveita `showTip`/`hideTip` dos cards).

A pedido do usuário (26/08/2026), removidos da página: o card de "Aceitou
Fundão" (etapa `excludeFromOverall` continua nos dados, só não renderiza),
o funil (`renderFunnel`/`.funnel`) e o `<details>` "Ver tabela de valores"
(`renderTable`/`table`) — substituídos pelo gráfico de comparação acima.
`test/shot.mjs` foi ajustado (não clica mais no `<details>` removido).

## Testes

```bash
npm test
```

- `aggregate.test.mjs` — o degrau de assinatura, a ordem fixa das barras, o
  Fundão fora da conta, "Não precisa" fora do denominador, células vazias, o
  casamento do nome da coluna com o typo corrigido, leitura de checkbox /
  files / select.
- `handlers.test.mjs` — os dois adaptadores contra uma API do Notion
  simulada: paginação de 150 candidatos, cabeçalhos de cache, `?fresh=1`, e os
  erros prováveis (sem token, base sem acesso).
- `polling.test.mjs` — a cadência real na página, com `page.clock` do
  Playwright.

`npm run shot` renderiza a página em claro, escuro e mobile em `/tmp/*.png` e
checa overflow horizontal e texto truncado. Rodar depois de mexer no layout —
o validador de paleta não vê colisão de rótulo.

## Estado atual e pendências

Em deploy na Netlify, a partir do GitHub. `netlify.toml` já define publish
`public` e functions `netlify/functions`, sem build command. Falta só a
variável `NOTION_TOKEN` (marcada como Secret, scope Functions).

Pendências abertas, em ordem:

1. **Decidir o fluxo das mulheres na etapa 6.** A base tem
   `Nota fiscal (mulheres)` e `Comprovante de pagamento (Mulheres)` como
   colunas separadas. Hoje a etapa 6 lê só a coluna dos homens e as 7 mulheres
   saem como "Não precisa". Se a prestação de contas delas também precisa ser
   acompanhada, a etapa 6 tem que ler duas colunas. Pergunta feita ao usuário,
   sem resposta.
2. Se o link for exposto demais, fechar com Netlify Identity ou Cloudflare
   Access.

## Snapshot dos dados (26/08/2026, 21 candidatos)

Para conferir se uma mudança quebrou a leitura. Lido direto da base.

| Coluna | Distribuição |
|---|---|
| `Já ligou?` | Sim 8 · Não 13 |
| `Já fez a procuração Advogado?` | Assinado 2 · Feito 14 · Pendente 5 |
| `Já foi feito o Material?` | Feito 3 · Pendente 18 |
| `Confecionado na gráfica?` | Feito 2 · Pendente 19 |
| `Já foi Pago?` | Feito 2 · Pendente 19 |
| `Certificado de doação (Homens)` | Feito 1 · Pendente 13 · Não precisa 7 |
| `Aceitou Fundão?` | Sim 17 · Não 3 · vazio 1 |
| `Gênero` | Homem 14 · Mulher 7 |

A distribuição acima é de antes da opção `Assinado` existir na coluna do
certificado — hoje ela já existe, então esta tabela está desatualizada para
essa coluna (as demais seguem válidas). Assumindo que ninguém assinou ainda
(a distribuição de `Feito`/`Pendente` não mudou, só a classificação), o
`Feito` do certificado passa a contar como `partial`: overall geral cai para
14% e o topo mostra 15 documentos esperando assinatura (14 da procuração + 1
do certificado). Reler a base para confirmar os números reais na próxima
atualização deste snapshot.
