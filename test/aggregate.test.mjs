import assert from "node:assert/strict";
import { buildStats, matchProperty, readValue, STAGES } from "../src/notion.js";

const statusProp = (options) => ({
  type: "status",
  status: { options: options.map((name) => ({ name, color: null })) },
});

// Schema com a grafia real da base, typo incluido.
const schema = {
  "Nome": { type: "title", title: {} },
  "Já ligou?": statusProp(["Feito", "Pendente"]),
  "Aceitou Fundão?": statusProp(["Feito", "Pendente"]),
  "Já foi feito o Material?": statusProp(["Feito", "Pendente"]),
  "Confecionado na gráfica?": statusProp(["Feito", "Pendente"]),
  "Já foi Pago?": statusProp(["Feito", "Pendente"]),
  "Certificado de doação (Homens)": statusProp(["Feito", "Pendente", "Não precisa"]),
};

const page = (values) => ({
  object: "page",
  archived: false,
  properties: Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      v === undefined ? { type: "status", status: null } : { type: "status", status: { name: v } },
    ])
  ),
});

const pages = [
  page({ "Já ligou?": "Feito", "Aceitou Fundão?": "Feito", "Já foi feito o Material?": "Feito",
         "Confecionado na gráfica?": "Feito", "Já foi Pago?": "Feito", "Certificado de doação (Homens)": "Feito" }),
  page({ "Já ligou?": "Feito", "Aceitou Fundão?": "Feito", "Já foi feito o Material?": "Pendente",
         "Confecionado na gráfica?": "Pendente", "Já foi Pago?": "Pendente", "Certificado de doação (Homens)": "Não precisa" }),
  page({ "Já ligou?": "Feito", "Aceitou Fundão?": "Pendente", "Já foi feito o Material?": "Pendente",
         "Confecionado na gráfica?": "Pendente", "Já foi Pago?": "Pendente", "Certificado de doação (Homens)": "Não precisa" }),
  page({ "Já ligou?": undefined, "Aceitou Fundão?": "Pendente", "Já foi feito o Material?": "Pendente",
         "Confecionado na gráfica?": "Pendente", "Já foi Pago?": "Pendente", "Certificado de doação (Homens)": "Pendente" }),
];

const env = {
  DONE_VALUES: "feito,assinado,concluido,pago,ok,sim",
  NA_VALUES: "nao precisa,nao se aplica,n/a",
};

const stats = buildStats(pages, schema, env);
const byKey = Object.fromEntries(stats.stages.map((s) => [s.key, s]));

// Todas as seis colunas foram encontradas, typo incluido.
for (const stage of STAGES) {
  assert.equal(byKey[stage.key].propertyFound, true, `coluna nao encontrada: ${stage.label}`);
}

assert.equal(stats.totalCandidates, 4);

// "Já ligou?": 3 feitos, 1 vazio -> 3/4
assert.equal(byKey.ligou.done, 3);
assert.equal(byKey.ligou.applicable, 4);

// Vazio vira bucket proprio e conta como pendente, nao como concluido.
const vazio = byKey.ligou.breakdown.find((b) => b.label === "Sem preenchimento");
assert.equal(vazio.count, 1);
assert.equal(vazio.kind, "empty");

// "Não precisa" sai do denominador: 1 feito, 1 pendente, 2 nao aplicaveis.
assert.equal(byKey.certificado.done, 1);
assert.equal(byKey.certificado.applicable, 2);
assert.equal(byKey.certificado.pct, 0.5);

// O funil so pode descer: cada etapa <= a anterior nesta amostra.
const seq = ["ligou", "fundao", "material", "grafica", "pago"].map((k) => byKey[k].done);
assert.deepEqual(seq, [3, 2, 1, 1, 1]);

// Geral: soma dos feitos sobre a soma dos aplicaveis.
assert.equal(stats.overall.done, 3 + 2 + 1 + 1 + 1 + 1);
assert.equal(stats.overall.applicable, 4 + 4 + 4 + 4 + 4 + 2);

// Fallback de nome: grafia corrigida do typo ainda encontra a coluna.
const fixed = { ...schema };
delete fixed["Confecionado na gráfica?"];
fixed["Confeccionado na gráfica?"] = statusProp(["Feito", "Pendente"]);
const refetched = buildStats(pages.map((p) => {
  const q = { ...p, properties: { ...p.properties } };
  q.properties["Confeccionado na gráfica?"] = q.properties["Confecionado na gráfica?"];
  return q;
}), fixed, env);
assert.equal(refetched.stages.find((s) => s.key === "grafica").propertyFound, true, "typo corrigido quebrou o match");

// Tipos alternativos de coluna.
assert.equal(readValue({ type: "checkbox", checkbox: true }), "Feito");
assert.equal(readValue({ type: "files", files: [] }), "Pendente");
assert.equal(readValue({ type: "files", files: [{ name: "rac.pdf" }] }), "Feito");
assert.equal(readValue({ type: "select", select: { name: "Assinado" } }), "Assinado");
assert.equal(readValue(undefined), null);

console.log("todos os testes passaram");
console.log(stats.stages.map((s) => `${s.label}: ${s.done}/${s.applicable} (${Math.round((s.pct ?? 0) * 100)}%)`).join("\n"));
