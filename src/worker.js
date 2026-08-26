/**
 * Missão Bahia — dashboard da Base de candidatos.
 *
 * O Worker guarda o token do Notion (secret NOTION_TOKEN) e expõe apenas um
 * resumo agregado em /api/stats. O token nunca chega ao navegador e a resposta
 * não contém nome, telefone ou qualquer dado pessoal dos candidatos.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const EDGE_TTL_SECONDS = 15;

/** As seis etapas pedidas, na ordem do fluxo operacional. */
const STAGES = [
  {
    key: "ligou",
    label: "Já ligou",
    property: "Já ligou?",
    aliases: ["Já ligou", "Ligou", "Ja ligou?"],
  },
  {
    key: "fundao",
    label: "Aceitou Fundão",
    property: "Aceitou Fundão?",
    aliases: ["Aceitou Fundão", "Aceitou fundao", "Fundão"],
  },
  {
    key: "material",
    label: "Material de campanha",
    property: "Já foi feito o Material?",
    aliases: ["Já foi feito o Material", "Material de campanha feito", "Material feito"],
  },
  {
    key: "grafica",
    label: "Confeccionado na gráfica",
    // A coluna hoje esta grafada "Confecionado" (um C). Os aliases cobrem a
    // grafia corrigida, para o dashboard nao quebrar se alguem arrumar o typo.
    property: "Confecionado na gráfica?",
    aliases: ["Confeccionado na gráfica?", "Confeccionado na grafica", "Gráfica"],
  },
  {
    key: "pago",
    label: "Pagamento",
    property: "Já foi Pago?",
    aliases: ["Já foi Pago", "Foi pago", "Pago?"],
  },
  {
    key: "certificado",
    label: "Certificado de doação",
    property: "Certificado de doação (Homens)",
    aliases: ["Certificado de doação", "Certificado de doacao (Homens)"],
  },
];

const EMPTY_LABEL = "Sem preenchimento";

/* ------------------------------------------------------------------ utils */

/** Normaliza para comparar nomes de coluna e de opção sem depender de acento,
 *  caixa ou pontuação. Tolera o typo "Confecionado" virar "Confeccionado". */
function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseList(raw, fallback) {
  const source = (raw ?? fallback ?? "").split(",");
  return source.map(norm).filter(Boolean);
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(extraHeaders ?? {}),
    },
  });
}

/* ------------------------------------------------------- chamadas ao Notion */

async function notion(path, token, init) {
  const response = await fetch(NOTION_API + path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* resposta nao-JSON */ }

  if (!response.ok) {
    const detail = payload?.message || text?.slice(0, 300) || response.statusText;
    const error = new Error(`Notion ${response.status}: ${detail}`);
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return payload;
}

/** Na versão 2025-09-03 a consulta acontece na data source, não na database. */
async function resolveDataSource(databaseId, token) {
  const database = await notion(`/databases/${databaseId}`, token);
  const sources = database?.data_sources ?? [];
  if (!sources.length) {
    throw new Error(
      "A base não expôs nenhuma data source. Confirme que o ID aponta para uma database e que a integração tem acesso a ela."
    );
  }
  return {
    dataSourceId: sources[0].id,
    databaseTitle:
      (database?.title ?? []).map((t) => t.plain_text).join("").trim() || null,
    databaseUrl: database?.url ?? null,
  };
}

async function queryAllPages(dataSourceId, token) {
  const pages = [];
  let cursor;

  // Teto de segurança: 40 páginas de 100 = 4.000 candidatos.
  for (let round = 0; round < 40; round += 1) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const chunk = await notion(`/data_sources/${dataSourceId}/query`, token, {
      method: "POST",
      body: JSON.stringify(body),
    });

    for (const page of chunk?.results ?? []) {
      if (page?.object === "page" && !page.archived && !page.in_trash) pages.push(page);
    }

    if (!chunk?.has_more || !chunk?.next_cursor) break;
    cursor = chunk.next_cursor;
  }
  return pages;
}

/* --------------------------------------------------- leitura das propriedades */

/** Encontra a coluna real no schema, tolerando acento, caixa e o typo do Notion. */
function matchProperty(schema, stage) {
  const names = Object.keys(schema ?? {});
  const wanted = [stage.property, ...(stage.aliases ?? [])];

  // 1. Igualdade exata apos normalizar (pega acento, caixa e pontuacao).
  for (const candidate of wanted) {
    const target = norm(candidate);
    const hit = names.find((n) => norm(n) === target);
    if (hit) return hit;
  }

  // 2. Um nome contido no outro ("Certificado de doacao" x "... (Homens)").
  for (const candidate of wanted) {
    const target = norm(candidate);
    if (target.length < 5) continue;
    const hit = names.find((n) => {
      const value = norm(n);
      return value.includes(target) || target.includes(value);
    });
    if (hit) return hit;
  }

  // 3. Ultimo recurso: maior sobreposicao de palavras significativas.
  const words = (value) =>
    norm(value.replace(/([a-z])([A-Z])/g, "$1 $2"))
      .length === 0
      ? []
      : String(value)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 3);

  const targetWords = new Set(wanted.flatMap(words));
  let best = null;
  let bestScore = 0;

  for (const name of names) {
    const score = words(name).filter((w) => targetWords.has(w)).length;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

/** Converte qualquer tipo de coluna em um rótulo de texto. */
function readValue(property) {
  if (!property) return null;

  switch (property.type) {
    case "status":       return property.status?.name ?? null;
    case "select":       return property.select?.name ?? null;
    case "multi_select": return (property.multi_select ?? []).map((o) => o.name).join(", ") || null;
    case "checkbox":     return property.checkbox ? "Feito" : "Pendente";
    case "files":        return (property.files ?? []).length > 0 ? "Feito" : "Pendente";
    case "people":       return (property.people ?? []).length > 0 ? "Feito" : "Pendente";
    case "date":         return property.date?.start ? "Feito" : "Pendente";
    case "rich_text":    return (property.rich_text ?? []).map((t) => t.plain_text).join("").trim() || null;
    case "title":        return (property.title ?? []).map((t) => t.plain_text).join("").trim() || null;
    case "number":       return property.number == null ? null : String(property.number);
    case "formula": {
      const f = property.formula;
      if (!f) return null;
      if (f.type === "string")  return f.string?.trim() || null;
      if (f.type === "boolean") return f.boolean ? "Feito" : "Pendente";
      if (f.type === "number")  return f.number == null ? null : String(f.number);
      if (f.type === "date")    return f.date?.start ? "Feito" : "Pendente";
      return null;
    }
    case "rollup": {
      const r = property.rollup;
      if (!r) return null;
      if (r.type === "number") return r.number == null ? null : String(r.number);
      if (r.type === "array")  return r.array?.length ? "Feito" : "Pendente";
      return null;
    }
    default: return null;
  }
}

/** Ordem das opções como o Notion as define, para o empilhamento ficar estável. */
function schemaOptions(definition) {
  if (!definition) return [];
  if (definition.type === "status") return definition.status?.options ?? [];
  if (definition.type === "select") return definition.select?.options ?? [];
  if (definition.type === "multi_select") return definition.multi_select?.options ?? [];
  if (definition.type === "checkbox") return [{ name: "Feito" }, { name: "Pendente" }];
  if (definition.type === "files") return [{ name: "Feito" }, { name: "Pendente" }];
  return [];
}

function classify(label, doneValues, naValues) {
  const key = norm(label);
  if (!key) return "empty";
  if (naValues.includes(key)) return "na";
  if (doneValues.includes(key)) return "done";
  return "pending";
}

/* -------------------------------------------------------------- agregacao */

function buildStats(pages, schema, env) {
  const doneValues = parseList(env.DONE_VALUES, "feito,assinado,concluido,pago,ok,sim");
  const naValues = parseList(env.NA_VALUES, "nao precisa,nao se aplica,n/a");

  let overallDone = 0;
  let overallApplicable = 0;

  const stages = STAGES.map((stage) => {
    const propertyName = matchProperty(schema, stage);
    const definition = propertyName ? schema[propertyName] : null;

    if (!propertyName) {
      return {
        ...stage,
        propertyFound: false,
        propertyName: null,
        type: null,
        total: pages.length,
        applicable: 0,
        done: 0,
        pct: null,
        breakdown: [],
      };
    }

    // Semeia os buckets com as opções do schema para manter a ordem do Notion,
    // inclusive as que ainda não têm nenhum registro.
    const buckets = new Map();
    for (const option of schemaOptions(definition)) {
      buckets.set(option.name, {
        label: option.name,
        notionColor: option.color ?? null,
        count: 0,
        kind: classify(option.name, doneValues, naValues),
      });
    }

    for (const page of pages) {
      const raw = readValue(page.properties?.[propertyName]);
      const label = raw ?? EMPTY_LABEL;

      if (!buckets.has(label)) {
        buckets.set(label, {
          label,
          notionColor: null,
          count: 0,
          kind: raw == null ? "empty" : classify(label, doneValues, naValues),
        });
      }
      buckets.get(label).count += 1;
    }

    const breakdown = [...buckets.values()];
    const total = pages.length;
    const notApplicable = breakdown.filter((b) => b.kind === "na").reduce((s, b) => s + b.count, 0);
    const done = breakdown.filter((b) => b.kind === "done").reduce((s, b) => s + b.count, 0);
    const applicable = total - notApplicable;

    overallDone += done;
    overallApplicable += applicable;

    return {
      ...stage,
      propertyFound: true,
      propertyName,
      type: definition?.type ?? null,
      total,
      applicable,
      done,
      pct: applicable > 0 ? done / applicable : null,
      breakdown: breakdown.map((b) => ({
        ...b,
        pct: total > 0 ? b.count / total : 0,
      })),
    };
  });

  return {
    totalCandidates: pages.length,
    overall: {
      done: overallDone,
      applicable: overallApplicable,
      pct: overallApplicable > 0 ? overallDone / overallApplicable : null,
    },
    stages,
  };
}

/* ------------------------------------------------------------------ rotas */

async function handleStats(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/stats", request.url).toString(), { method: "GET" });

  const url = new URL(request.url);
  if (url.searchParams.get("fresh") !== "1") {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const token = env.NOTION_TOKEN;
  const databaseId = (env.NOTION_DATABASE_ID ?? "").trim();

  if (!token) {
    return json({ ok: false, error: "NOTION_TOKEN não configurado. Rode: npx wrangler secret put NOTION_TOKEN" }, 500);
  }
  if (!databaseId) {
    return json({ ok: false, error: "NOTION_DATABASE_ID não configurado no wrangler.toml." }, 500);
  }

  try {
    const { dataSourceId, databaseTitle, databaseUrl } = await resolveDataSource(databaseId, token);
    const [source, pages] = await Promise.all([
      notion(`/data_sources/${dataSourceId}`, token),
      queryAllPages(dataSourceId, token),
    ]);

    const stats = buildStats(pages, source?.properties ?? {}, env);

    const response = json(
      {
        ok: true,
        fetchedAt: new Date().toISOString(),
        title: env.DASHBOARD_TITLE || "Missão Bahia",
        subtitle: env.DASHBOARD_SUBTITLE || databaseTitle || "Base de candidatos",
        databaseUrl,
        ...stats,
      },
      200,
      { "cache-control": `public, max-age=${EDGE_TTL_SECONDS}` }
    );

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    const status = error.status === 401 || error.status === 404 ? error.status : 502;
    const hint =
      error.status === 401
        ? "Token inválido ou expirado."
        : error.status === 404
        ? "A integração não tem acesso a essa base. No Notion, abra a base e use ··· > Conexões > adicione a integração."
        : null;
    return json({ ok: false, error: String(error.message || error), hint }, status, {
      "cache-control": "no-store",
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats") {
      if (request.method !== "GET") return json({ ok: false, error: "Método não permitido" }, 405);
      return handleStats(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Rota não encontrada" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

/* Exportados para os testes em test/aggregate.test.mjs */
export { norm, matchProperty, readValue, buildStats, STAGES };
