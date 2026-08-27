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
3. **Dado pessoal só na seção "Candidatos com pendência"** (ver "Privacidade").
   Os agregados por etapa continuam só contagem; nome, foto e WhatsApp saem
   *apenas* de quem tem pendência, decisão explícita do usuário em
   26/08/2026, sabendo que o link é público e sem login.
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

Deploy do adaptador alternativo (`src/worker.js`): `npx wrangler deploy`, configurado
por `wrangler.toml`. Não faz parte do fluxo principal (Netlify), só existe como
alternativa de host.

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

Tudo em `src/config.js` é sobrescrevível por variável de ambiente (Netlify ou
`.env` local), com o default hardcoded como fallback: `NOTION_DATABASE_ID`,
`DASHBOARD_TITLE`/`DASHBOARD_SUBTITLE`, `DONE_VALUES`, `SIGNED_VALUES`,
`NA_VALUES`, `EDGE_TTL_SECONDS`. Não precisa mexer em código para trocar a
base, os rótulos ou o que conta como concluído — só a variável.

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
| 2 | `Já mandou o requerimento de abertura de conta?` | Não / vazio | — | **Sim** | — |
| 3 | `Já fez a procuração Advogado?` | Pendente | Feito | **Assinado** | — |
| 4 | `Já foi feito o Material?` | Pendente | — | **Feito** | — |
| 5 | `Confecionado na gráfica?` | Pendente | — | **Feito** | — |
| 6 | `Já foi Pago?` | Pendente | — | **Feito** | — |
| 7 | `Certificado de doação (Homens)` | Pendente | Feito | **Assinado** | Não precisa |
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
3. Intervalo único de 5 min (`POLL_MS`), ativo ou ocioso — a pedido do
   usuário em 26/08/2026, no lugar do esquema anterior de 30s ativo / 3 min
   ocioso. Voltar de uma aba escondida ou tocar a página depois de ociosa
   *não* adianta a busca; só dispara se o dado já tiver de fato passado dos
   5 min (`Date.now() - lastOkAt >= POLL_MS`). `IDLE_AFTER_MS` continua
   existindo só para o rótulo "em espera" no indicador — não afeta a
   cadência de busca.

Orçamento medido: aba esquecida 24h/dia ≈ 8,6 mil/mês (`test/polling.test.mjs`
mede isso com relógio controlado — 12 varreduras/hora, para a conta não virar
suposição). Uma pessoa usando a página ativamente 8h úteis/dia fica em ≈ 96
buscas/dia (≈ 2,9 mil/mês); multiplique pelo tamanho real da equipe para o
teto — mesmo várias pessoas juntas, o intervalo fixo de 5 min mantém a conta
bem abaixo do limite de 125 mil.

**Antes de mexer em `POLL_MS`, `IDLE_AFTER_MS` (ambos em
`public/index.html`) ou `EDGE_TTL_SECONDS`, refaça a conta.**

### Não é tempo real, é pull

Atraso máximo de 5 min em qualquer regime (ativo ou ocioso) — intervalo fixo,
não varia mais com o uso. O botão Atualizar manda `?fresh=1`, pula o cache e
lê o Notion em 1-2s, com 5s de cooldown por usuário, para quem não quer
esperar o ciclo.

Webhook do Notion não ajudaria — já foi investigado. O evento
`page.properties_updated` é agregado e a Notion promete entrega "em até 5
minutos, a maioria em até 1 minuto". Mais lento que a varredura atual, com
mais peça para dar defeito. **Não reabrir essa discussão sem dado novo.**

Limite do Notion: média de 3 req/s por integração. Cada leitura completa gasta
3 chamadas (database + data source + 1 por página de 100).

## Privacidade

Regra geral: `/api/stats` devolve contagens agregadas. Número de campanha,
cidade, gênero e os PDFs nunca saem do servidor.

**Exceção deliberada, decidida com o usuário em 26/08/2026:** o campo
`candidatesPending` traz nome, foto e WhatsApp — mas só de quem tem alguma
etapa não fechada (`pending`/`empty`/`partial` em pelo menos uma etapa que
conta; ver `buildStats()` em `src/notion.js`). Quem terminou tudo que se
aplica não aparece nesse campo, nem por engano. O usuário pediu essa exposição
sabendo que o link é público e sem login — foi perguntado explicitamente se
queria proteger a seção com login antes (Netlify Identity / Cloudflare
Access) e escolheu não proteger. **Não reverter essa decisão sem confirmar de
novo com o usuário — é inversão de uma escolha consciente, não correção de
bug.**

Colunas usadas: `CANDIDATE_FIELDS` em `src/notion.js` (`Nome`, `Foto`,
`WhatsApp`), casadas pelo mesmo `matchProperty()` tolerante a acento/typo que
as etapas usam. Se a base não tiver uma dessas colunas, o campo correspondente
vem `null` sem quebrar nada (`readTitleValue`/`readFileUrlListValue`/
`readTextLikeValue`). A URL de foto que o Notion devolve para colunas
"Files & media" hospedadas por ele expira depois de um tempo; como
`buildStats()` roda a cada leitura, a URL é sempre a mais recente — a
página troca por um avatar de iniciais se a imagem já tiver expirado
(`img.onerror` em `renderPending()`). `Foto` pode ter mais de um arquivo:
`readFileUrlListValue()` devolve todos, na ordem do Notion, em
`candidate.photos`; `photoUrl` (usado no avatar pequeno) é sempre `photos[0]`
para não duplicar a URL mais recente em dois formatos.

`candidatesPending` também traz `notionUrl` (`page.url`), um link direto para
a página do candidato no Notion — usado para deixar o nome clicável na lista.
É uma exceção dentro da exceção: diferente de nome/foto/WhatsApp, esse campo
não vem de uma coluna escolhida a dedo, é a URL da página inteira (26
colunas, inclusive as que nunca são agregadas). Só é seguro expor porque abrir
o link exige acesso ao workspace do Notion — quem só tem o link do dashboard
não entra na página. **Se esse pressuposto mudar (ex.: a base virar
compartilhada publicamente no Notion), reavaliar com o usuário antes de
manter `notionUrl` na resposta.**

**Ao adicionar qualquer *outro* campo à resposta da API, verificar se ele é
agregado — a exceção acima é a única aprovada, não um precedente geral.**

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
- **Skeleton na primeira carga** (`renderSkeleton()`): só entra quando ainda
  não existe `lastData` — nas buscas de fundo seguintes (a cada 5 min, ver
  "O limite da Netlify") o conteúdo antigo permanece na tela, só com opacidade
  reduzida via `.loading`, para não piscar/re-fluir a cada ciclo. Blocos
  cinza (`.skel`, animação `shimmer`, respeita `prefers-reduced-motion`) no
  formato de cada elemento real (hero, cards, gráfico, lista de pendência).

Três blocos de visualização, todos em `public/index.html`:

- **Cards por etapa** (`renderCards` / `.card`): barra empilhada por status
  (`done`/`partial`/`pending`/`na`/`empty`), cor categórica de status — o
  detalhamento por etapa. Cada card é clicável e abre `#stage-modal`
  (`openStageModal`) com a lista de quem está pendente *naquela* etapa
  (`candidatesForStage`, mesma fonte de "Candidatos com pendência", filtrada
  pela `stage.key`). Ordenação própria desse modal (`sortStageRows`), diferente
  da lista geral: quem está mais longe de terminar vem primeiro (`pending`
  antes de `partial`/aguardando assinatura) e, dentro do mesmo status,
  alfabética (`localeCompare` com `"pt-BR"`) — pedido do usuário em
  26/08/2026, para ler a lista como um to-do do mais urgente ao quase-pronto,
  não pela ordem de pendências gerais do candidato. O botão **PNG** no
  cabeçalho do modal (`buildStagePendingCanvas`) desenha num `<canvas>` a
  mesma lista já ordenada, mais o percentual e a barra de progresso da etapa,
  e baixa como imagem — pensado para quem precisa levar a lista pronta para
  uma reunião ou grupo, sem print de tela. Sem lib de captura (`html2canvas`
  etc.): desenha diretamente, lendo as cores do tema atual via
  `getComputedStyle` (senão o PNG destoa se alguém trocar de tema depois de
  gerado). Avatar no PNG é sempre iniciais, nunca a foto — evitaria uma
  requisição cross-origin (CORS) num export que deve funcionar offline depois
  de baixado.
- **Comparação entre etapas** (`renderChart` / `.chart`): um gráfico de
  barras horizontais, uma por etapa, todas na mesma cor (`--accent`) porque é
  uma única medida (% concluído) comparada entre categorias — não uma
  identidade a distinguir. Tem grade e eixo em 0/25/50/75/100% e tooltip por
  barra (reaproveita `showTip`/`hideTip` dos cards).
- **Candidatos com pendência** (`renderPending` / `.pending-list`): lista de
  quem tem alguma etapa não fechada, ordenada pela API (mais pendências
  primeiro). Único bloco com dado pessoal — ver "Privacidade". Cada linha
  (`.prow`) é avatar (foto ou iniciais em `.prow-avatar`), nome (linkado para
  `notionUrl` quando existe), link `wa.me/<dígitos>` do WhatsApp quando dá
  para extrair dígito, e uma etiqueta (`.tag`) por etapa pendente
  reaproveitando `ICONS`/cores de `--st-partial` e `--st-pending` das barras —
  mesma linguagem visual, não uma paleta nova. Lista vazia mostra uma
  mensagem positiva (`.pending-empty`) em vez de nada. Quando `candidate.photos`
  tem alguma foto, o avatar vira botão e abre `#photo-modal`: carrossel
  (`‹`/`›`, ou seta do teclado) quando há mais de uma, e "Baixar foto" busca a
  imagem como blob para forçar o download — a URL do Notion é de outra
  origem, então o atributo `download` sozinho não bastaria; se o `fetch`
  falhar (CORS), cai para abrir a foto numa aba nova.

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
  files / select, e a lista de pendência por candidato (quem some da lista ao
  terminar tudo, ordenação por quantidade de pendência, `partial` vs.
  `pending`, e que o Fundão nunca vira pendência mesmo com "Não").
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
3. **Modal de foto (carrossel + download) e link do nome para o Notion já
   estão commitados, mas ainda sem cobertura em `aggregate.test.mjs`.**
   `middle.photoUrl` é o único teste hoje que toca
   nesses campos. Antes de considerar a feature pronta, cobrir `photos`
   (múltiplas fotos, ordem) e `notionUrl` no teste de agregação.
4. **`#stage-modal` (ordenação por status/nome e export PNG) não tem teste
   automatizado.** É lógica só de front-end (`sortStageRows`,
   `buildStagePendingCanvas` em `public/index.html`), fora do que
   `aggregate.test.mjs` cobre (agregação) e do que `shot.mjs` verifica hoje
   (não abre nenhum card). Se for cobrir, é `shot.mjs` ou um teste novo de
   Playwright que clica um card e confere a ordem da lista renderizada.

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
