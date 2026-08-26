import assert from "node:assert/strict";
import { buildStats, readValue, STAGES } from "../src/notion.js";

const opts = (names) => ({ type: "status", status: { options: names.map((name) => ({ name })) } });

// Schema com a grafia real da base: typo "Confecionado", "Já ligou?" em Sim/Não
// e a procuração com o degrau extra de assinatura.
const schema = {
  "Nome": { type: "title", title: {} },
  "WhatsApp": { type: "phone_number", phone_number: {} },
  "Já ligou?": opts(["Não", "Sim"]),
  "Aceitou Fundão?": opts(["Sim", "Não"]),
  "Já fez a procuração Advogado?": opts(["Pendente", "Feito", "Assinado"]),
  "Já foi feito o Material?": opts(["Pendente", "Feito"]),
  "Confecionado na gráfica?": opts(["Pendente", "Feito"]),
  "Já foi Pago?": opts(["Pendente", "Feito"]),
  "Certificado de doação (Homens)": opts(["Não precisa", "Pendente", "Feito"]),
};

const page = (v) => ({
  object: "page", archived: false,
  properties: Object.fromEntries(Object.entries(v).map(([k, val]) =>
    [k, { type: "status", status: val === null ? null : { name: val } }])),
});

// Anexa nome (title) e WhatsApp (phone_number) a uma página já criada com
// page(), para testar a seção "candidatos com pendência" sem misturar tipos
// diferentes de propriedade no helper acima.
const withIdentity = (pg, { name, whatsapp }) => ({
  ...pg,
  properties: {
    ...pg.properties,
    "Nome": { type: "title", title: [{ plain_text: name }] },
    "WhatsApp": { type: "phone_number", phone_number: whatsapp },
  },
});

const pages = [
  page({ "Já ligou?": "Sim", "Aceitou Fundão?": "Sim", "Já fez a procuração Advogado?": "Assinado",
         "Já foi feito o Material?": "Feito", "Confecionado na gráfica?": "Feito",
         "Já foi Pago?": "Feito", "Certificado de doação (Homens)": "Feito" }),
  page({ "Já ligou?": "Sim", "Aceitou Fundão?": "Sim", "Já fez a procuração Advogado?": "Feito",
         "Já foi feito o Material?": "Pendente", "Confecionado na gráfica?": "Pendente",
         "Já foi Pago?": "Pendente", "Certificado de doação (Homens)": "Não precisa" }),
  page({ "Já ligou?": "Sim", "Aceitou Fundão?": "Não", "Já fez a procuração Advogado?": "Feito",
         "Já foi feito o Material?": "Pendente", "Confecionado na gráfica?": "Pendente",
         "Já foi Pago?": "Pendente", "Certificado de doação (Homens)": "Não precisa" }),
  page({ "Já ligou?": null, "Aceitou Fundão?": "Não", "Já fez a procuração Advogado?": "Pendente",
         "Já foi feito o Material?": "Pendente", "Confecionado na gráfica?": "Pendente",
         "Já foi Pago?": "Pendente", "Certificado de doação (Homens)": "Pendente" }),
].map((pg, i) => withIdentity(pg, {
  name: ["Candidata em dia", "Candidato com pendência", "Outro com pendência", "Sem nenhum toque"][i],
  whatsapp: "+55 71 9" + i + "999-0000",
}));

const env = {
  DONE_VALUES: "feito,concluido,pago,ok,sim",
  SIGNED_VALUES: "assinado,assinada",
  NA_VALUES: "nao precisa,nao se aplica,n/a",
};

const stats = buildStats(pages, schema, env);
const by = Object.fromEntries(stats.stages.map((s) => [s.key, s]));

// Todas as sete colunas encontradas, typo incluído.
for (const stage of STAGES) {
  assert.equal(by[stage.key].propertyFound, true, `coluna não encontrada: ${stage.label}`);
}
assert.equal(stats.totalCandidates, 4);

/* ---------------------------------------- documento com degrau de assinatura */

const proc = by.procuracao;
assert.equal(proc.requiresSignature, true, "a procuração deveria ser detectada como documento");
assert.equal(proc.done, 1, "só 'Assinado' conta como concluído");
assert.equal(proc.partial, 2, "'Feito' vira etapa intermediária, não concluída");
assert.equal(proc.pct, 0.25);
assert.equal(proc.breakdown.find((b) => b.label === "Feito").kind, "partial");
assert.equal(proc.breakdown.find((b) => b.label === "Assinado").kind, "done");

// Numa coluna sem assinatura, "Feito" continua sendo o fim da linha.
assert.equal(by.pago.requiresSignature, false);
assert.equal(by.pago.done, 1);
assert.equal(by.pago.partial, 0);
assert.equal(by.pago.breakdown.find((b) => b.label === "Feito").kind, "done");

/* ------------------------------------------------- ordem sempre igual na barra */

for (const stage of stats.stages) {
  const kinds = stage.breakdown.map((b) => b.kind);
  const rank = { done: 0, partial: 1, pending: 2, empty: 3, na: 4 };
  const sorted = [...kinds].sort((a, b) => rank[a] - rank[b]);
  assert.deepEqual(kinds, sorted, `barra fora de ordem em ${stage.label}: ${kinds.join(",")}`);
}
assert.equal(by.ligou.breakdown[0].label, "Sim",
  "mesmo com 'Não' primeiro no Notion, o concluído abre a barra");

/* ----------------------------------------------------- fundão fora da conta */

assert.equal(by.fundao.excludeFromOverall, true);
assert.equal(by.fundao.done, 2, "o card do Fundão continua mostrando o número");
assert.equal(stats.overall.stages, 6, "seis etapas deveriam entrar na conta geral");

// Geral = soma das seis etapas que contam, sem o Fundão.
const counted = ["ligou", "procuracao", "material", "grafica", "pago", "certificado"];
assert.equal(stats.overall.done, counted.reduce((s, k) => s + by[k].done, 0));
assert.equal(stats.overall.applicable, counted.reduce((s, k) => s + by[k].applicable, 0));
assert.ok(!counted.includes("fundao"));

/* ------------------------------------------------------------- outros casos */

assert.equal(by.ligou.breakdown.find((b) => b.label === "Sem preenchimento").kind, "empty");
assert.equal(by.certificado.applicable, 2, "'Não precisa' sai do denominador");
assert.equal(readValue({ type: "checkbox", checkbox: true }), "Feito");
assert.equal(readValue({ type: "files", files: [{ name: "rac.pdf" }] }), "Feito");

/* --------------------------------------------------- candidatos com pendência */

// Quem fechou tudo que se aplica não entra na lista — nem por engano.
assert.ok(
  !stats.candidatesPending.some((c) => c.name === "Candidata em dia"),
  "candidato sem pendência não deveria aparecer na lista"
);

// "Não" em Já ligou é Sim/Não (etapa 1), e as três primeiras páginas ligaram;
// a quarta (índice 3) tem "Já ligou?" vazio, então soma mais uma pendência.
assert.equal(stats.candidatesPending.length, 3, "só quem tem pendência aparece");

const worst = stats.candidatesPending[0];
assert.equal(worst.name, "Sem nenhum toque", "mais pendências primeiro");
assert.equal(worst.pending.length, 6);
assert.ok(worst.pending.some((p) => p.stageKey === "ligou" && p.status === "pending"),
  "célula vazia também é pendência");
assert.ok(!worst.pending.some((p) => p.stageKey === "fundao"),
  "Fundão nunca vira pendência, mesmo com valor 'Não'");

const middle = stats.candidatesPending.find((c) => c.name === "Candidato com pendência");
assert.equal(middle.pending.length, 4);
assert.ok(middle.pending.some((p) => p.stageKey === "procuracao" && p.status === "partial"),
  "documento feito mas não assinado é pendência 'partial', não 'pending'");
assert.equal(middle.whatsapp, "+55 71 91999-0000");
assert.equal(middle.photoUrl, null, "sem coluna Foto na base de teste, fica null sem quebrar");

console.log("agregação: assinatura, ordem das barras, Fundão fora da conta e pendências por candidato — ok");
console.log(stats.stages.map((s) =>
  `  ${s.label}: ${s.done}/${s.applicable}` +
  (s.partial ? ` (+${s.partial} aguardando assinatura)` : "") +
  (s.excludeFromOverall ? " [fora do cálculo]" : "")).join("\n"));
