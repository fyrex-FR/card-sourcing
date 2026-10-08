import { existsSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { z } from "zod";
import type { Poller } from "../alerts/poller.js";
import type { Config } from "../config.js";
import type { Repo, SearchPatch } from "../db/repo.js";
import type { Search } from "../db/schema.js";
import { EbayError, EbayRateLimitError } from "../ebay/client.js";
import { MARKETPLACES } from "../ebay/marketplaces.js";
import { SESSION_TTL_MS } from "./auth.js";
import type { LoginChallenge, LoginLinks } from "./auth.js";
import type { StatusDto } from "./dto.js";
import { PreviewSchema, SearchInputSchema, SearchPatchSchema } from "./schemas.js";

/** Interface web compilée (web/dist), à deux niveaux de ce fichier (src/web ou dist/web). */
export const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

const SESSION_COOKIE = "session";
const LINK_REQUEST_COOLDOWN_MS = 30_000;
/** Ces champs changent les résultats : le stock existant est ré-enregistré en silence. */
const RESEED_FIELDS = ["query", "maxPrice", "buying", "country", "excludes", "marketplaces"] as const;

export interface WebDeps {
  repo: Repo;
  poller: Poller;
  links: LoginLinks;
  sendLoginLink: (challenge: LoginChallenge) => Promise<void>;
  config: Pick<Config, "sessionSecret" | "publicUrl" | "homeCurrency" | "defaultMarketplaces" | "ebayDailyBudget">;
  /** Dossier des fichiers statiques ; null pour ne servir que l'API. */
  staticRoot?: string | null;
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => {
    throw new HttpError(400, "JSON invalide");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
  return parsed.data;
}

function parseId(c: Context): number {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new HttpError(404, "Recherche introuvable");
  return id;
}

export function createWebApp(deps: WebDeps): Hono {
  const { repo, poller, links, config } = deps;
  const app = new Hono();
  const secureCookie = config.publicUrl.startsWith("https://");
  let lastLinkRequest = 0;

  const checkInBackground = (search: Search) => {
    if (!search.active) return;
    poller.checkSearch(search).catch((error: unknown) => console.error(`[web] vérification #${search.id}:`, error));
  };

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    if (error instanceof EbayRateLimitError) return c.json({ error: "Quota eBay atteint, réessaie plus tard." }, 429);
    if (error instanceof EbayError) return c.json({ error: error.message }, 502);
    console.error("[web]", error);
    return c.json({ error: "Erreur interne" }, 500);
  });

  // --- public ------------------------------------------------------------------

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth/request", async (c) => {
    if (Date.now() - lastLinkRequest < LINK_REQUEST_COOLDOWN_MS) {
      throw new HttpError(429, "Un lien vient d'être envoyé, regarde Telegram.");
    }
    lastLinkRequest = Date.now();
    try {
      await deps.sendLoginLink(links.create());
    } catch (error) {
      lastLinkRequest = 0;
      throw new HttpError(502, `Impossible d'envoyer le lien sur Telegram : ${error instanceof Error ? error.message : String(error)}`);
    }
    return c.json({ sent: true });
  });

  const openSession = (c: Context) =>
    setSignedCookie(c, SESSION_COOKIE, String(Date.now() + SESSION_TTL_MS), config.sessionSecret, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });

  app.get("/auth/callback", async (c) => {
    if (!links.consumeToken(c.req.query("token") ?? "")) return c.redirect("/?login=expired");
    await openSession(c);
    return c.redirect("/");
  });

  app.post("/api/auth/code", async (c) => {
    const { code } = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
    if (typeof code !== "string" || !links.consumeCode(code)) throw new HttpError(401, "Code invalide ou expiré");
    await openSession(c);
    return c.json({ ok: true });
  });

  // --- tout le reste de l'API exige une session ---------------------------------

  app.use("/api/*", async (c, next) => {
    const value = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE);
    if (!value || Number(value) < Date.now()) throw new HttpError(401, "Non connecté");
    await next();
  });

  app.get("/api/me", (c) => c.json({ ok: true }));

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/status", async (c) => {
    const [status, state] = await Promise.all([poller.status(), repo.getState()]);
    const body: StatusDto = {
      paused: state.paused,
      lastCycleAt: state.lastCycleAt?.toISOString() ?? null,
      activeSearches: status.active.length,
      callsPerCycle: status.callsPerCycle,
      intervalSeconds: status.intervalSeconds,
      callsToday: status.callsToday,
      dailyBudget: config.ebayDailyBudget,
      homeCurrency: config.homeCurrency,
      defaultMarketplaces: config.defaultMarketplaces,
      marketplaces: MARKETPLACES,
    };
    return c.json(body);
  });

  app.put("/api/state", async (c) => {
    const { paused } = await c.req.json<{ paused?: unknown }>();
    if (typeof paused !== "boolean") throw new HttpError(400, "paused attendu");
    await repo.setState({ paused });
    if (!paused) poller.wake();
    return c.json({ paused });
  });

  // --- recherches -----------------------------------------------------------------

  app.get("/api/searches", async (c) => c.json(await repo.listSearches()));

  app.post("/api/searches", async (c) => {
    const input = await parseBody(c, SearchInputSchema);
    const search = await repo.createSearch(input);
    checkInBackground(search);
    return c.json(search, 201);
  });

  app.patch("/api/searches/:id", async (c) => {
    const id = parseId(c);
    const current = await repo.getSearch(id);
    if (!current) throw new HttpError(404, "Recherche introuvable");
    const patch: SearchPatch = await parseBody(c, SearchPatchSchema);
    const reseed = RESEED_FIELDS.some((field) => field in patch && JSON.stringify(patch[field]) !== JSON.stringify(current[field]));
    const updated = (await repo.updateSearch(id, { ...patch, ...(reseed ? { seeded: false, lastError: null } : {}) }))!;
    if (reseed) checkInBackground(updated);
    poller.wake();
    return c.json(updated);
  });

  app.delete("/api/searches/:id", async (c) => {
    if (!(await repo.deleteSearch(parseId(c)))) throw new HttpError(404, "Recherche introuvable");
    return c.json({ ok: true });
  });

  app.post("/api/searches/:id/check", async (c) => {
    const search = await repo.getSearch(parseId(c));
    if (!search) throw new HttpError(404, "Recherche introuvable");
    return c.json({ sent: await poller.checkSearch(search) });
  });

  app.post("/api/preview", async (c) => {
    const criteria = await parseBody(c, PreviewSchema);
    return c.json(await poller.preview(criteria));
  });

  // --- alertes et vendeurs ----------------------------------------------------------

  app.get("/api/alerts", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 60, 1), 200);
    return c.json(await repo.alertHistory(limit));
  });

  app.post("/api/items/:key/mute", async (c) => {
    await repo.muteItem(c.req.param("key"));
    return c.json({ ok: true });
  });

  app.get("/api/blocked-sellers", async (c) => c.json([...(await repo.blockedSellers())]));

  app.post("/api/blocked-sellers", async (c) => {
    const { username } = await c.req.json<{ username?: unknown }>();
    if (typeof username !== "string" || !username.trim()) throw new HttpError(400, "Vendeur requis");
    await repo.blockSeller(username.trim());
    return c.json({ ok: true });
  });

  app.delete("/api/blocked-sellers/:username", async (c) => {
    await repo.unblockSeller(c.req.param("username"));
    return c.json({ ok: true });
  });

  app.all("/api/*", () => {
    throw new HttpError(404, "Route inconnue");
  });

  // --- interface web (SPA) -------------------------------------------------------------

  const root = deps.staticRoot === undefined ? WEB_DIST : deps.staticRoot;
  if (root && existsSync(root)) {
    const relativeRoot = relative(process.cwd(), root) || ".";
    app.use("/*", serveStatic({ root: relativeRoot }));
    app.get("*", serveStatic({ root: relativeRoot, path: "index.html" }));
  }

  return app;
}
