/**
 * Netlify Function (v2) — GET /api/stats
 *
 * Guarda o token do Notion no ambiente. A resposta é majoritariamente
 * contagens agregadas, com uma exceção deliberada: `candidatesPending` traz
 * nome, foto e WhatsApp de quem tem pendência (ver src/notion.js e
 * CLAUDE.md > Privacidade). O link do dashboard é público e sem login, então
 * esse dado fica visível para qualquer um que tiver o link.
 */
import { fetchStats, describeError } from "../../src/notion.js";
import { readConfig } from "../../src/config.js";

export default async (request) => {
  const config = readConfig(process.env);
  const url = new URL(request.url);

  // O botão "Atualizar" manda ?fresh=1 e pula o cache do CDN.
  const bypass = url.searchParams.get("fresh") === "1";

  const headers = {
    "content-type": "application/json; charset=utf-8",
    // O navegador nunca guarda: quem decide a validade é o CDN.
    "cache-control": "no-store",
    // "durable" faz um nó de borda reaproveitar o que outro já buscou,
    // o que segura a contagem de invocações no plano gratuito.
    "netlify-cdn-cache-control": bypass
      ? "no-store"
      : `public, durable, max-age=${config.edgeTtl}, stale-while-revalidate=${config.edgeTtl * 2}`,
    // Sem isso, /api/stats e /api/stats?fresh=1 dividiriam a mesma entrada.
    "netlify-vary": "query=fresh",
  };

  try {
    const payload = await fetchStats(config);
    return new Response(JSON.stringify(payload), { status: 200, headers });
  } catch (error) {
    const { status, message, hint } = describeError(error);
    return new Response(JSON.stringify({ ok: false, error: message, hint }), {
      status,
      headers: { ...headers, "netlify-cdn-cache-control": "no-store" },
    });
  }
};

export const config = {
  path: "/api/stats",
};
