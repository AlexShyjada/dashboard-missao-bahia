/**
 * Adaptador Cloudflare Workers — alternativa à Netlify, mesmo núcleo.
 * O deploy documentado no README é o da Netlify; este arquivo fica aqui
 * caso um dia valha migrar. Rode com: npx wrangler deploy
 */
import { fetchStats, describeError } from "./notion.js";
import { readConfig } from "./config.js";

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers ?? {}) },
  });
}

async function handleStats(request, env, ctx) {
  const config = readConfig(env);
  const url = new URL(request.url);
  const bypass = url.searchParams.get("fresh") === "1";

  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/stats", request.url).toString(), { method: "GET" });

  if (!bypass) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    const payload = await fetchStats(config);
    const response = json(payload, 200, { "cache-control": `public, max-age=${config.edgeTtl}` });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    const { status, message, hint } = describeError(error);
    return json({ ok: false, error: message, hint }, status, { "cache-control": "no-store" });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats") {
      if (request.method !== "GET") return json({ ok: false, error: "Método não permitido" }, 405);
      return handleStats(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Rota não encontrada" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};
