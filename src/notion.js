/**
 * Núcleo compartilhado: fala com a API do Notion e agrega as seis etapas.
 *
 * Não conhece nem Cloudflare nem Netlify. Os adaptadores em
 * netlify/functions/stats.mjs e src/worker.js só cuidam de rota e cache.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const EDGE_TTL_SECONDS = 10;

/** As seis etapas pedidas, na ordem do fluxo operacional. */
const STAGES = [
  {
    key: "ligou",
    label: "Ligações de Rafael",
    property: "Já ligou?",
    aliases: ["Já ligou", "Ligou", "Ja ligou?"],
  },
  {
    key: "procuracao",
    label: "Procuração advogado",
    property: "Já fez a procuração Advogado?",
    aliases: ["Já fez a procuração Advogado", "Procuração advogado", "Fez a procuracao"],
  },
  {
    // Marcador de entrada, não tarefa de execução: aparece na tela mas fica
    // fora do percentual geral e do funil.
    key: "fundao",
    label: "Aceitou Fundão",
    property: "Aceitou Fundão?",
    aliases: ["Aceitou Fundão", "Aceitou fundao", "Fundão"],
    excludeFromOverall: true,
  },
  {
    key: "material",
    label: "Design do material de campanha",
    property: "Já foi feito o Material?",
    aliases: ["Já foi feito o Material", "Material de campanha feito", "Material feito"],
  },
  {
    key: "grafica",
    label: "Impressão do material de campanha na gráfica",
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

/**
 * Classifica um valor em cinco estados.
 *
 * Colunas de documento têm três degraus: Pendente -> Feito -> Assinado. Nelas,
 * "Feito" significa documento confeccionado mas ainda sem assinatura, então vira
 * `partial` e não conta como concluído. Numa coluna sem opção de assinatura
 * ("Já foi Pago?", por exemplo) "Feito" continua sendo o fim da linha.
 *
 * @param {boolean} columnHasSigned a coluna oferece algum valor de assinatura
 */
function classify(label, cfg, columnHasSigned) {
  const key = norm(label);
  if (!key) return "empty";
  if (cfg.na.includes(key)) return "na";
  if (cfg.signed.includes(key)) return "done";
  if (cfg.done.includes(key)) return columnHasSigned ? "partial" : "done";
  return "pending";
}

/** Ordem de leitura das barras: o progresso cresce da esquerda para a direita. */
const KIND_ORDER = { done: 0, partial: 1, pending: 2, empty: 3, na: 4 };

/* -------------------------------------------------------------- agregacao */

export function buildStats(pages, schema, env) {
  const cfg = {
    done: parseList(env.DONE_VALUES, "feito,concluido,pago,ok,sim"),
    signed: parseList(env.SIGNED_VALUES, "assinado,assinada"),
    na: parseList(env.NA_VALUES, "nao precisa,nao se aplica,n/a"),
  };

  const total = pages.length;
  let overallDone = 0;
  let overallApplicable = 0;

  const stages = STAGES.map((stage) => {
    const propertyName = matchProperty(schema, stage);
    const definition = propertyName ? schema[propertyName] : null;

    if (!propertyName) {
      return {
        ...stage, propertyFound: false, propertyName: null, type: null,
        total, applicable: 0, done: 0, partial: 0, pct: null,
        requiresSignature: false, breakdown: [],
      };
    }

    // 1ª passada: descobre todos os rótulos que a coluna usa, somando as opções
    // do schema (ordem do Notion, inclusive as zeradas) e os valores gravados.
    const counts = new Map();
    const meta = new Map();
    for (const option of schemaOptions(definition)) {
      counts.set(option.name, 0);
      meta.set(option.name, { notionColor: option.color ?? null, fromSchema: true });
    }
    for (const page of pages) {
      const raw = readValue(page.properties?.[propertyName]);
      const label = raw ?? EMPTY_LABEL;
      if (!counts.has(label)) {
        counts.set(label, 0);
        meta.set(label, { notionColor: null, fromSchema: false, isEmpty: raw == null });
      }
      counts.set(label, counts.get(label) + 1);
    }

    // Se a coluna oferece "Assinado", ela é um documento: "Feito" passa a ser
    // etapa intermediária e só a assinatura conta como concluída.
    const requiresSignature = [...counts.keys()].some((label) => cfg.signed.includes(norm(label)));

    const breakdown = [...counts.entries()].map(([label, count]) => ({
      label,
      count,
      notionColor: meta.get(label)?.notionColor ?? null,
      kind: meta.get(label)?.isEmpty ? "empty" : classify(label, cfg, requiresSignature),
      pct: total > 0 ? count / total : 0,
    }));

    // Progresso cresce da esquerda para a direita, igual em todas as barras;
    // dentro de um mesmo estado, a ordem do Notion é preservada.
    breakdown.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

    const sum = (kind) => breakdown.filter((b) => b.kind === kind).reduce((acc, b) => acc + b.count, 0);
    const done = sum("done");
    const partial = sum("partial");
    const applicable = total - sum("na");

    if (!stage.excludeFromOverall) {
      overallDone += done;
      overallApplicable += applicable;
    }

    return {
      ...stage,
      propertyFound: true,
      propertyName,
      type: definition?.type ?? null,
      requiresSignature,
      total,
      applicable,
      done,
      partial,
      pct: applicable > 0 ? done / applicable : null,
      breakdown,
    };
  });

  return {
    totalCandidates: total,
    overall: {
      done: overallDone,
      applicable: overallApplicable,
      pct: overallApplicable > 0 ? overallDone / overallApplicable : null,
      // Quantas etapas realmente entram na conta geral.
      stages: stages.filter((st) => !st.excludeFromOverall && st.propertyFound).length,
    },
    stages,
  };
}

/* ----------------------------------------------------------- ponto de entrada */

/**
 * Lê a base e devolve o payload que o dashboard consome.
 * Lança Error com .status quando o Notion recusa (401 / 404).
 */
export async function fetchStats(config) {
  const token = config.token;
  const databaseId = String(config.databaseId || "").trim();

  if (!token) {
    const error = new Error("NOTION_TOKEN não configurado.");
    error.status = 500;
    error.hint = "Defina a variável de ambiente NOTION_TOKEN no painel do seu host.";
    throw error;
  }
  if (!databaseId) {
    const error = new Error("NOTION_DATABASE_ID não configurado.");
    error.status = 500;
    throw error;
  }

  const { dataSourceId, databaseTitle, databaseUrl } = await resolveDataSource(databaseId, token);
  const [source, pages] = await Promise.all([
    notion(`/data_sources/${dataSourceId}`, token),
    queryAllPages(dataSourceId, token),
  ]);

  const stats = buildStats(pages, source?.properties ?? {}, {
    DONE_VALUES: config.doneValues,
    SIGNED_VALUES: config.signedValues,
    NA_VALUES: config.naValues,
  });

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    title: config.title || "Missão Bahia",
    subtitle: config.subtitle || databaseTitle || "Base de candidatos",
    databaseUrl,
    ...stats,
  };
}

/** Traduz o erro do Notion em status HTTP e uma dica acionável. */
export function describeError(error) {
  const status = error?.status === 401 || error?.status === 404 || error?.status === 500
    ? error.status
    : 502;
  const hint =
    error?.hint ??
    (error?.status === 401
      ? "Token inválido ou expirado. Gere outro em notion.so/profile/integrations."
      : error?.status === 404
      ? "A integração não tem acesso a essa base. No Notion, abra a base e use ··· > Conexões > adicione a integração."
      : null);
  return { status, message: String(error?.message || error), hint };
}

export { NOTION_VERSION, STAGES, norm, matchProperty, readValue };
