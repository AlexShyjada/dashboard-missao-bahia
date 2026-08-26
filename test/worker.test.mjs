import assert from "node:assert/strict";
import worker from "../src/worker.js";

const DB = "3c14f290d5c480d7b649ee415cf17433";
const DS = "aaaa1111bbbb2222cccc3333dddd4444";

const statusProp = (o) => ({ type: "status", status: { options: o.map((name) => ({ name, color: "default" })) } });
const SCHEMA = {
  "Nome": { type: "title", title: {} },
  "Já ligou?": statusProp(["Feito", "Pendente"]),
  "Aceitou Fundão?": statusProp(["Feito", "Pendente"]),
  "Já foi feito o Material?": statusProp(["Feito", "Pendente"]),
  "Confecionado na gráfica?": statusProp(["Feito", "Pendente"]),
  "Já foi Pago?": statusProp(["Feito", "Pendente"]),
  "Certificado de doação (Homens)": statusProp(["Feito", "Pendente", "Não precisa"]),
};

const makePage = (i) => ({
  object: "page", archived: false, in_trash: false,
  properties: {
    "Nome": { type: "title", title: [{ plain_text: "Candidato " + i }] },
    "Já ligou?": { type: "status", status: { name: i < 120 ? "Feito" : "Pendente" } },
    "Aceitou Fundão?": { type: "status", status: { name: i < 90 ? "Feito" : "Pendente" } },
    "Já foi feito o Material?": { type: "status", status: null },
    "Confecionado na gráfica?": { type: "status", status: { name: "Pendente" } },
    "Já foi Pago?": { type: "status", status: { name: "Pendente" } },
    "Certificado de doação (Homens)": { type: "status", status: { name: i % 2 ? "Não precisa" : "Pendente" } },
  },
});
const ALL = Array.from({ length: 150 }, (_, i) => makePage(i));

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: init?.method || "GET", auth: init?.headers?.authorization,
               version: init?.headers?.["notion-version"] });
  const u = String(url);
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  if (u.endsWith(`/databases/${DB}`))
    return ok({ object: "database", id: DB, url: "https://notion.so/x", title: [{ plain_text: "Base de candidatos" }],
                data_sources: [{ id: DS, name: "Base de candidatos" }] });
  if (u.endsWith(`/data_sources/${DS}`))
    return ok({ object: "data_source", id: DS, properties: SCHEMA });
  if (u.endsWith(`/data_sources/${DS}/query`)) {
    const body = JSON.parse(init.body);
    const start = body.start_cursor ? Number(body.start_cursor) : 0;
    const slice = ALL.slice(start, start + 100);
    const next = start + 100;
    return ok({ object: "list", results: slice, has_more: next < ALL.length, next_cursor: next < ALL.length ? String(next) : null });
  }
  return new Response(JSON.stringify({ message: "not found", code: "object_not_found" }), { status: 404 });
};

// Cache API minima (o Worker usa caches.default).
const store = new Map();
globalThis.caches = { default: {
  async match(req) { const v = store.get(req.url); return v ? v.clone() : undefined; },
  async put(req, res) { store.set(req.url, res.clone()); },
} };

const env = {
  NOTION_TOKEN: "ntn_fake", NOTION_DATABASE_ID: DB,
  DASHBOARD_TITLE: "Missão Bahia", DASHBOARD_SUBTITLE: "Base de candidatos",
  DONE_VALUES: "feito,assinado,concluido,pago,ok,sim", NA_VALUES: "nao precisa,nao se aplica,n/a",
  ASSETS: { fetch: async () => new Response("<html>página</html>", { headers: { "content-type": "text/html" } }) },
};
const ctx = { waitUntil: (p) => p };

const res = await worker.fetch(new Request("https://x.workers.dev/api/stats"), env, ctx);
const data = await res.json();

assert.equal(res.status, 200);
assert.equal(data.ok, true);
assert.equal(data.totalCandidates, 150, "paginacao nao trouxe as 150 paginas");

const by = Object.fromEntries(data.stages.map((s) => [s.key, s]));
assert.equal(by.ligou.done, 120);
assert.equal(by.fundao.done, 90);
assert.equal(by.grafica.propertyFound, true, "coluna com typo nao encontrada");

// Celula vazia vira bucket proprio, nao some da conta.
const vazio = by.material.breakdown.find((b) => b.label === "Sem preenchimento");
assert.equal(vazio.count, 150);
assert.equal(by.material.done, 0);

// "Não precisa" sai do denominador.
assert.equal(by.certificado.applicable, 75);

// Cabecalhos e metodo corretos na chamada ao Notion.
const query = calls.find((c) => c.url.endsWith("/query"));
assert.equal(query.method, "POST");
assert.equal(query.version, "2025-09-03");
assert.equal(query.auth, "Bearer ntn_fake");

// Segunda chamada vem do cache de borda, sem bater no Notion de novo.
const before = calls.length;
await worker.fetch(new Request("https://x.workers.dev/api/stats"), env, ctx);
assert.equal(calls.length, before, "cache de borda nao funcionou");

// Sem token: erro explicito, nao stack trace.
const noToken = await worker.fetch(new Request("https://x.workers.dev/api/stats?fresh=1"), { ...env, NOTION_TOKEN: "" }, ctx);
assert.equal(noToken.status, 500);
assert.match((await noToken.json()).error, /NOTION_TOKEN/);

// Base sem acesso: mensagem acionavel.
const bad = await worker.fetch(new Request("https://x.workers.dev/api/stats?fresh=1"), { ...env, NOTION_DATABASE_ID: "zzz" }, ctx);
const badBody = await bad.json();
assert.equal(bad.status, 404);
assert.match(badBody.hint, /Conex/);

// Rota da pagina cai nos assets.
const pageRes = await worker.fetch(new Request("https://x.workers.dev/"), env, ctx);
assert.equal(await pageRes.text(), "<html>página</html>");

console.log("worker: todos os testes passaram (150 candidatos em 2 páginas, cache e erros ok)");
