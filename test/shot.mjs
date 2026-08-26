import { chromium } from "playwright";
import fs from "node:fs";
import { buildStats } from "../src/worker.js";

const statusProp = (o) => ({ type: "status", status: { options: o.map((name) => ({ name, color: null })) } });
const schema = {
  "Já ligou?": statusProp(["Feito", "Pendente"]),
  "Aceitou Fundão?": statusProp(["Feito", "Pendente"]),
  "Já foi feito o Material?": statusProp(["Feito", "Pendente"]),
  "Confecionado na gráfica?": statusProp(["Feito", "Pendente"]),
  "Já foi Pago?": statusProp(["Feito", "Pendente"]),
  "Certificado de doação (Homens)": statusProp(["Feito", "Pendente", "Não precisa"]),
};
const rows = Array.from({ length: 21 }, (_, i) => ({
  object: "page", archived: false,
  properties: Object.fromEntries(Object.entries({
    "Já ligou?": i < 18 ? "Feito" : i === 20 ? null : "Pendente",
    "Aceitou Fundão?": i < 14 ? "Feito" : "Pendente",
    "Já foi feito o Material?": i < 4 ? "Feito" : "Pendente",
    "Confecionado na gráfica?": i < 3 ? "Feito" : "Pendente",
    "Já foi Pago?": i < 2 ? "Feito" : "Pendente",
    "Certificado de doação (Homens)": i % 3 !== 0 ? (i < 2 ? "Feito" : "Pendente") : "Não precisa",
  }).map(([k, v]) => [k, { type: "status", status: v ? { name: v } : null }])),
}));
const payload = {
  ok: true, fetchedAt: new Date().toISOString(),
  title: "Missão Bahia", subtitle: "Base de candidatos",
  databaseUrl: "https://www.notion.so/exemplo",
  ...buildStats(rows, schema, { DONE_VALUES: "feito,pago,sim", NA_VALUES: "nao precisa,n/a" }),
};

const file = "file://" + fs.realpathSync("public/index.html");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const [scheme, width, name] of [["light", 1280, "light"], ["dark", 1280, "dark"], ["light", 390, "mobile"]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/api/stats*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.goto(file);
  await page.waitForSelector(".card", { timeout: 5000 });
  await page.locator("details.table-view > summary").click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll(".card-title,.fname,.stat b,.lg")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim().slice(0, 40)));
  console.log(name, "| erros:", errors.length ? errors : "nenhum", "| overflow-x:", overflow, "| truncados:", clipped.length ? clipped : "nenhum");
  await ctx.close();
}
await browser.close();
