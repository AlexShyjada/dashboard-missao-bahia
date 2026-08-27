import { chromium } from "playwright";
import fs from "node:fs";
import { buildStats } from "../src/notion.js";

const opts = (n) => ({ type: "status", status: { options: n.map((name) => ({ name })) } });

// Contagens reais lidas da base em 26/08: 21 candidatos.
const schema = {
  "Nome": { type: "title", title: {} },
  "WhatsApp": { type: "phone_number", phone_number: {} },
  "Foto": { type: "files" },
  "Já ligou?": opts(["Não", "Sim"]),
  "Aceitou Fundão?": opts(["Sim", "Não"]),
  "Já fez a procuração Advogado?": opts(["Pendente", "Feito", "Assinado"]),
  "Já foi feito o Material?": opts(["Pendente", "Feito"]),
  "Confecionado na gráfica?": opts(["Pendente", "Feito"]),
  "Já foi Pago?": opts(["Pendente", "Feito"]),
  // Com a opção "Assinado" já criada no Notion.
  "Certificado de doação (Homens)": opts(["Não precisa", "Pendente", "Feito", "Assinado"]),
};

const dist = (col, mapa) => {
  const out = [];
  Object.entries(mapa).forEach(([valor, n]) => { for (let i = 0; i < n; i += 1) out.push(valor); });
  return out;
};
// Data URI (1x1 px) em vez de URL externa — o teste não deve depender de rede.
const PHOTO_STUB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const fotoDist = dist(0, { "Feito": 16, "Pendente": 5 });

const cols = {
  "Já ligou?": dist(0, { "Sim": 8, "Não": 13 }),
  "Aceitou Fundão?": dist(0, { "Sim": 17, "Não": 3, "__vazio": 1 }),
  "Já fez a procuração Advogado?": dist(0, { "Assinado": 2, "Feito": 14, "Pendente": 5 }),
  "Já foi feito o Material?": dist(0, { "Feito": 3, "Pendente": 18 }),
  "Confecionado na gráfica?": dist(0, { "Feito": 2, "Pendente": 19 }),
  "Já foi Pago?": dist(0, { "Feito": 2, "Pendente": 19 }),
  "Certificado de doação (Homens)": dist(0, { "Feito": 1, "Pendente": 13, "Não precisa": 7 }),
};

// Um nome propositalmente comprido, para o checador de truncamento pegar
// estouro de texto no card de pendência também.
const NAMES = [
  "Maria Aparecida de Souza Nascimento Bittencourt Filha", "João Pedro Alves", "Ana Clara Ribeiro",
  "Carlos Eduardo Santos", "Fernanda Lima", "Rafael Costa", "Juliana Pereira", "Marcos Vinícius",
  "Beatriz Almeida", "Lucas Gabriel", "Camila Rocha", "Thiago Barbosa", "Larissa Martins",
  "Gustavo Henrique", "Patrícia Nunes", "Bruno Cardoso", "Vanessa Teixeira", "Diego Fernandes",
  "Renata Gomes", "André Luiz", "Sabrina Dias",
];

const rows = Array.from({ length: 21 }, (_, i) => ({
  object: "page", archived: false,
  properties: {
    "Nome": { type: "title", title: [{ plain_text: NAMES[i] }] },
    "WhatsApp": { type: "phone_number", phone_number: "+55 71 9" + (1000 + i) + "-" + (2000 + i) },
    "Foto": { type: "files", files: fotoDist[i] === "Feito" ? [{ type: "external", external: { url: PHOTO_STUB } }] : [] },
    ...Object.fromEntries(Object.keys(cols).map((k) => {
      const v = cols[k][i];
      return [k, { type: "status", status: !v || v === "__vazio" ? null : { name: v } }];
    })),
  },
}));

const payload = {
  ok: true, fetchedAt: new Date().toISOString(),
  title: "Missão Bahia", subtitle: "Base de candidatos",
  databaseUrl: "https://www.notion.so/exemplo",
  ...buildStats(rows, schema, {
    DONE_VALUES: "feito,concluido,pago,ok,sim",
    SIGNED_VALUES: "assinado,assinada",
    NA_VALUES: "nao precisa,nao se aplica,n/a",
  }),
};

const file = "file://" + fs.realpathSync("public/index.html");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const [scheme, width, name] of [["light", 1280, "light"], ["dark", 1280, "dark"], ["light", 390, "mobile"]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/api/stats*", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.goto(file);
  await page.waitForSelector(".card");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll(".card-title,.chart-label,.stat b,.lg,.card-note")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim().slice(0, 40)));
  console.log(name, "| erros:", errors.length ? errors : "nenhum", "| overflow-x:", overflow, "| truncados:", clipped.length ? clipped : "nenhum");
  await ctx.close();
}
await browser.close();
