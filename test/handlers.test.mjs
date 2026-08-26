/**
 * Testa os dois adaptadores contra uma API do Notion simulada:
 * a Netlify Function (alvo do deploy) e o Worker da Cloudflare.
 */
import assert from "node:assert/strict";

const DB = "3c14f290d5c480d7b649ee415cf17433";
const DS = "aaaa1111bbbb2222cccc3333dddd4444";

const statusProp = (o) => ({ type: "status", status: { options: o.map((name) => ({ name, color: "default" })) } });
const SCHEMA = {
  "Nome": { type: "title", title: {} },
  "Já ligou?": statusProp(["Feito", "Pendente"]),
  "Aceitou Fundão?": statusProp(["Sim", "Não"]),
  "Já fez a procuração Advogado?": statusProp(["Pendente", "Feito", "Assinado"]),
  "Já foi feito o Material?": statusProp(["Feito", "Pendente"]),
  "Confecionado na gráfica?": statusProp(["Feito", "Pendente"]),
  "Já foi Pago?": statusProp(["Feito", "Pendente"]),
  "Certificado de doação (Homens)": statusProp(["Feito", "Pendente", "Não precisa"]),
};

const ALL = Array.from({ length: 150 }, (_, i) => ({
  object: "page", archived: false, in_trash: false,
  properties: {
    "Nome": { type: "title", title: [{ plain_text: "Candidato " + i }] },
    "Já ligou?": { type: "status", status: { name: i < 120 ? "Feito" : "Pendente" } },
    "Aceitou Fundão?": { type: "status", status: { name: i < 90 ? "Sim" : "Não" } },
    "Já fez a procuração Advogado?": { type: "status", status: { name: i < 30 ? "Assinado" : i < 100 ? "Feito" : "Pendente" } },
    "Já foi feito o Material?": { type: "status", status: null },
    "Confecionado na gráfica?": { type: "status", status: { name: "Pendente" } },
    "Já foi Pago?": { type: "status", status: { name: "Pendente" } },
    "Certificado de doação (Homens)": { type: "status", status: { name: i % 2 ? "Não precisa" : "Pendente" } },
  },
}));

let calls = [];
let dbId = DB;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, method: init?.method || "GET", auth: init?.headers?.authorization, version: init?.headers?.["notion-version"] });
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

  if (u.endsWith(`/databases/${dbId}`) && dbId === DB)
    return ok({ object: "database", id: DB, url: "https://notion.so/x",
                title: [{ plain_text: "Base de candidatos" }], data_sources: [{ id: DS }] });
  if (u.endsWith(`/data_sources/${DS}`)) return ok({ object: "data_source", id: DS, properties: SCHEMA });
  if (u.endsWith(`/data_sources/${DS}/query`)) {
    const start = JSON.parse(init.body).start_cursor ? Number(JSON.parse(init.body).start_cursor) : 0;
    const next = start + 100;
    return ok({ object: "list", results: ALL.slice(start, next),
                has_more: next < ALL.length, next_cursor: next < ALL.length ? String(next) : null });
  }
  return new Response(JSON.stringify({ message: "Could not find database", code: "object_not_found" }), { status: 404 });
};

const ENV = {
  NOTION_TOKEN: "ntn_fake", NOTION_DATABASE_ID: DB,
  DASHBOARD_TITLE: "Missão Bahia", DASHBOARD_SUBTITLE: "Base de candidatos",
  DONE_VALUES: "feito,concluido,pago,ok,sim", SIGNED_VALUES: "assinado,assinada",
  NA_VALUES: "nao precisa,nao se aplica,n/a",
  EDGE_TTL_SECONDS: "20",
};

/* ------------------------------------------------------------- Netlify ---- */

process.env = { ...process.env, ...ENV };
const { default: statsFn, config: statsCfg } = await import("../netlify/functions/stats.mjs");

assert.equal(statsCfg.path, "/api/stats", "a rota da função precisa ser /api/stats");

calls = [];
let res = await statsFn(new Request("https://site.netlify.app/api/stats"));
let body = await res.json();

assert.equal(res.status, 200);
assert.equal(body.ok, true);
assert.equal(body.totalCandidates, 150, "paginação não trouxe as 150 páginas");

const by = Object.fromEntries(body.stages.map((s) => [s.key, s]));
assert.equal(by.ligou.done, 120);
assert.equal(by.fundao.done, 90);
assert.equal(by.fundao.excludeFromOverall, true, "o Fundão precisa ficar fora da conta geral");
assert.equal(by.procuracao.requiresSignature, true);
assert.equal(by.procuracao.done, 30, "só assinados contam");
assert.equal(by.procuracao.partial, 70, "os 'Feito' ficam como aguardando assinatura");
assert.equal(body.overall.stages, 6, "seis etapas na conta geral, sem o Fundão");
assert.ok(!body.stages.filter((s) => !s.excludeFromOverall).some((s) => s.key === "fundao"));
assert.equal(by.grafica.propertyFound, true, "coluna com o typo 'Confecionado' não foi encontrada");
assert.equal(by.material.breakdown.find((b) => b.label === "Sem preenchimento").count, 150);
assert.equal(by.certificado.applicable, 75, "'Não precisa' deveria sair do denominador");

// Cabeçalhos de cache: o CDN guarda, o navegador não.
assert.match(res.headers.get("netlify-cdn-cache-control"), /durable/);
assert.match(res.headers.get("netlify-cdn-cache-control"), /max-age=20/);
assert.equal(res.headers.get("cache-control"), "no-store");
assert.equal(res.headers.get("netlify-vary"), "query=fresh",
  "sem netlify-vary, /api/stats e ?fresh=1 dividiriam a mesma entrada de cache");

// O botão Atualizar não pode ser cacheado.
const fresh = await statsFn(new Request("https://site.netlify.app/api/stats?fresh=1"));
assert.equal(fresh.headers.get("netlify-cdn-cache-control"), "no-store");

// Chamada ao Notion com método, versão e token certos.
const query = calls.find((c) => c.url.endsWith("/query"));
assert.equal(query.method, "POST");
assert.equal(query.version, "2025-09-03");
assert.equal(query.auth, "Bearer ntn_fake");

// Sem token: erro explícito, e nunca cacheado.
process.env.NOTION_TOKEN = "";
const noToken = await statsFn(new Request("https://site.netlify.app/api/stats"));
assert.equal(noToken.status, 500);
assert.match((await noToken.json()).error, /NOTION_TOKEN/);
assert.equal(noToken.headers.get("netlify-cdn-cache-control"), "no-store", "erro não pode ficar em cache");
process.env.NOTION_TOKEN = "ntn_fake";

// Base sem acesso: mensagem que diz o que fazer.
dbId = "zzz"; process.env.NOTION_DATABASE_ID = "zzz";
const denied = await statsFn(new Request("https://site.netlify.app/api/stats"));
assert.equal(denied.status, 404);
assert.match((await denied.json()).hint, /Conex/);
dbId = DB; process.env.NOTION_DATABASE_ID = DB;

/* ----------------------------------------------------------- Cloudflare ---- */

const store = new Map();
globalThis.caches = { default: {
  async match(req) { const v = store.get(req.url); return v ? v.clone() : undefined; },
  async put(req, r) { store.set(req.url, r.clone()); },
} };

const { default: worker } = await import("../src/worker.js");
const ctx = { waitUntil: (p) => p };
const wEnv = { ...ENV, ASSETS: { fetch: async () => new Response("<html>página</html>") } };

const w1 = await worker.fetch(new Request("https://x.workers.dev/api/stats"), wEnv, ctx);
assert.equal((await w1.json()).totalCandidates, 150);

calls = [];
await worker.fetch(new Request("https://x.workers.dev/api/stats"), wEnv, ctx);
assert.equal(calls.length, 0, "a segunda leitura deveria vir do cache de borda");

await worker.fetch(new Request("https://x.workers.dev/api/stats?fresh=1"), wEnv, ctx);
assert.ok(calls.length > 0, "?fresh=1 deveria furar o cache");

const page = await worker.fetch(new Request("https://x.workers.dev/"), wEnv, ctx);
assert.equal(await page.text(), "<html>página</html>");

console.log("adaptadores: Netlify e Cloudflare passaram (150 candidatos, cache, ?fresh=1 e erros)");
