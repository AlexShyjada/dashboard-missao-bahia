/**
 * Verifica a cadência de varredura na página real, com relógio controlado:
 * ativo = 30s, ocioso = 3min, e volta ao ritmo ativo no primeiro toque.
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

// Fase ativa: um toque a cada 20s mantém a página "em uso".
hits = [];
for (let i = 0; i < 6; i += 1) {
  await page.clock.runFor(20000);
  await page.mouse.move(300 + i, 300);
  await page.waitForTimeout(60);
}
assert.ok(hits.length >= 3 && hits.length <= 5,
  `ativo por 2 min deveria render ~4 varreduras, deu ${hits.length}`);

// Entra em ócio (5 min sem toque) e depois mede o regime permanente.
await page.clock.runFor(6 * 60 * 1000);
await page.waitForTimeout(150);
hits = [];
await page.clock.runFor(30 * 60 * 1000);
await page.waitForTimeout(200);
assert.ok(hits.length <= 12,
  `30 min de aba esquecida deveria render ~10 varreduras, deu ${hits.length}`);
assert.ok(hits.length >= 6, `mesmo ocioso precisa continuar varrendo, deu ${hits.length}`);
console.log("  aba esquecida: " + hits.length + " varreduras em 30 min (~" +
  Math.round(hits.length * 2 * 24 * 30) + " invocações/mês se ficar 24h por dia)");

// O indicador avisa que está em espera.
assert.match(await page.textContent("#freshness"), /em espera/);

// Primeiro toque tira do modo ocioso e busca na hora.
hits = [];
await page.mouse.click(400, 400);
await page.waitForTimeout(200);
assert.equal(hits.length, 1, "o toque depois do ócio deveria disparar uma busca imediata");
assert.doesNotMatch(await page.textContent("#freshness"), /em espera/);

// O botão Atualizar fura o cache do CDN.
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
console.log("cadência: ativo 30s, ocioso 3min, retomada no toque e cooldown do botão — ok");
