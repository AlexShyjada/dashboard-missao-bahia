/**
 * Verifica a cadência de varredura na página real, com relógio controlado:
 * intervalo único de 5 min, ativo ou ocioso, sem busca antecipada ao voltar.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildStats } from "../src/notion.js";

const statusProp = (o) => ({ type: "status", status: { options: o.map((n) => ({ name: n })) } });
const schema = { "Já ligou?": statusProp(["Feito", "Pendente"]) };
const rows = [{ object: "page", archived: false,
  properties: { "Já ligou?": { type: "status", status: { name: "Feito" } } } }];
const payload = { ok: true, title: "T", subtitle: "S",
  ...buildStats(rows, schema, { DONE_VALUES: "feito", NA_VALUES: "nao precisa" }) };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.clock.install();

let hits = [];
await page.route("**/api/stats*", (route) => {
  hits.push(route.request().url());
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
});

await page.goto("file://" + fs.realpathSync("public/index.html"));
await page.waitForSelector(".card");
assert.equal(hits.length, 1, "deveria buscar uma vez ao abrir");

// Mesmo com toques constantes, a cadência não acelera: continua em 5 min.
hits = [];
for (let i = 0; i < 6; i += 1) {
  await page.clock.runFor(20000);
  await page.mouse.move(300 + i, 300);
  await page.waitForTimeout(60);
}
assert.equal(hits.length, 0, `2 min de uso ativo não deveria buscar de novo, deu ${hits.length}`);

await page.clock.runFor(3 * 60 * 1000);
await page.waitForTimeout(150);
assert.equal(hits.length, 1, `aos 5 min deveria disparar exatamente uma busca, deu ${hits.length}`);

// Regime permanente, aba esquecida (sem nenhum toque) por 1h: 5 min fixos.
hits = [];
await page.clock.runFor(60 * 60 * 1000);
await page.waitForTimeout(200);
assert.ok(hits.length >= 11 && hits.length <= 12, `1h de aba esquecida deveria render ~12 varreduras (a cada 5 min), deu ${hits.length}`);
console.log("  aba esquecida: " + hits.length + " varreduras em 1h (~" +
  Math.round(hits.length * 24 * 30) + " invocações/mês se ficar 24h por dia)");

// O indicador avisa que está em espera (rótulo, não muda a cadência).
assert.match(await page.textContent("#freshness"), /em espera/);

// Voltar da aba não adianta a busca: o dado ainda está fresco (< 5 min).
// Usa o teclado em vez de um clique em coordenada fixa — os cards de etapa
// agora abrem modal ao clicar, e uma coordenada arbitrária pode cair em um.
hits = [];
await page.keyboard.press("Shift");
await page.waitForTimeout(200);
assert.equal(hits.length, 0, "o toque não deveria disparar busca com dado ainda fresco");
await page.clock.runFor(1000); // deixa o relógio (mockado) rodar o setInterval do rótulo
assert.doesNotMatch(await page.textContent("#freshness"), /em espera/);

// Só busca de novo quando o dado realmente completar 5 min.
await page.clock.runFor(5 * 60 * 1000);
await page.waitForTimeout(150);
assert.equal(hits.length, 1, "deveria buscar assim que os 5 min completarem, mesmo sem toque");

// O botão Atualizar fura o cache do CDN e independe do intervalo de fundo.
hits = [];
await page.click("#refresh");
await page.waitForTimeout(200);
assert.equal(hits.length, 1);
assert.match(hits[0], /fresh=1/, "o botão precisa mandar ?fresh=1");

// E respeita o cooldown de 5s: fica travado e volta sozinho.
assert.equal(await page.getAttribute("#refresh", "disabled"), "",
  "o botão deveria travar logo após o clique");
assert.match(await page.textContent("#refresh"), /Atualizando/);

await page.clock.runFor(5200);
await page.waitForTimeout(150);
assert.equal(await page.getAttribute("#refresh", "disabled"), null,
  "o botão deveria destravar depois de 5s");
assert.equal(await page.textContent("#refresh"), "Atualizar");

await browser.close();
console.log("cadência: intervalo fixo de 5 min, ativo ou ocioso, sem busca antecipada e cooldown do botão — ok");
