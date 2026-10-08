import { timingSafeEqual } from "node:crypto";
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
import { MARKETPLACES, VINTED, isVinted } from "../ebay/marketplaces.js";
import { SESSION_TTL_MS } from "./auth.js";
import type { LoginChallenge, LoginLinks } from "./auth.js";
import type { SettingsDto, StatusDto } from "./dto.js";
import { ItemPatchSchema, PreviewSchema, SearchInputSchema, SearchPatchSchema, SettingsSchema, VintedPushSchema } from "./schemas.js";

/** Interface web compilée (web/dist), à deux niveaux de ce fichier (src/web ou dist/web). */
export const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

const SESSION_COOKIE = "session";
const LINK_REQUEST_COOLDOWN_MS = 30_000;
/** Ces champs changent les résultats : le stock existant est ré-enregistré en silence. */
const RESEED_FIELDS = [
  "query",
  "maxPrice",
  "buying",
  "country",
  "excludes",
  "marketplaces",
  "requiredWords",
  "grading",
  "excludeLots",
  "minSellerFeedbackPct",
  "minSellerFeedbackScore",
] as const;

export interface WebDeps {
  repo: Repo;
  poller: Poller;
  links: LoginLinks;
  sendLoginLink: (challenge: LoginChallenge) => Promise<void>;
  config: Pick<Config, "sessionSecret" | "publicUrl" | "homeCurrency" | "defaultMarketplaces" | "ebayDailyBudget"> & Partial<Pick<Config, "vintedAgentToken">>;
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

function confirmLoginPage(token: string): string {
  const safe = token.replace(/[^A-Za-z0-9_-]/g, "");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connexion</title><style>
:root{color-scheme:light dark;font:16px system-ui,sans-serif}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:Canvas;color:CanvasText;padding:16px}
form{max-width:340px;width:100%;text-align:center;display:grid;gap:14px}button{font:inherit;font-weight:600;padding:14px;border:0;border-radius:12px;background:#3557e0;color:#fff;cursor:pointer}
p{opacity:.75;margin:0}</style></head><body>
<form method="post" action="/auth/callback"><h1>Alerteur eBay</h1><p>Connecte ce navigateur à l'interface.</p>
<input type="hidden" name="token" value="${safe}"><button type="submit">Se connecter</button></form></body></html>`;
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

  // Le lien n'est consommé qu'au clic sur le bouton (POST) : un aperçu ou un robot qui charge l'URL ne le grille pas.
  app.get("/auth/callback", (c) => c.html(confirmLoginPage(c.req.query("token") ?? "")));

  app.post("/auth/callback", async (c) => {
    const form = await c.req.parseBody();
    if (!links.consumeToken(typeof form.token === "string" ? form.token : "")) return c.redirect("/?login=expired");
    await openSession(c);
    return c.redirect("/");
  });

  app.post("/api/auth/code", async (c) => {
    const { code } = await c.req.json<{ code?: unknown }>().catch(() => ({ code: undefined }));
    if (typeof code !== "string" || !links.consumeCode(code)) throw new HttpError(401, "Code invalide ou expiré");
    await openSession(c);
    return c.json({ ok: true });
  });

  // --- agent OpenClaw : recherches Vinted (jeton dédié, pas de session) ------------------

  const requireAgent = (c: Context) => {
    const expected = Buffer.from(config.vintedAgentToken ?? "");
    const given = Buffer.from(c.req.header("x-agent-token") ?? "");
    if (expected.length === 0 || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new HttpError(401, "Jeton agent invalide");
    }
  };

  app.get("/api/vinted/searches", async (c) => {
    requireAgent(c);
    const rows = await repo.listSearches({ activeOnly: true, source: "vinted" });
    return c.json(rows.map(({ id, query, maxPrice }) => ({ id, query, maxPrice })));
  });

  app.post("/api/vinted/items", async (c) => {
    requireAgent(c);
    const body = await parseBody(c, VintedPushSchema);
    const search = await repo.getSearch(body.searchId);
    if (!search || !isVinted(search)) throw new HttpError(404, "Recherche Vinted introuvable");
    const now = poller.now();
    const matching = body.items.filter((item) => {
      const title = item.title.toLowerCase();
      return (
        (search.maxPrice === null || item.price <= search.maxPrice) &&
        !search.excludes.some((word) => title.includes(word)) &&
        search.requiredWords.every((word) => title.includes(word))
      );
    });
    const keyOf = (externalId: string) => `vinted:${externalId}`;
    const known = await repo.getItems(matching.map((item) => keyOf(item.externalId)));
    const fresh = matching.filter((item) => !known.has(keyOf(item.externalId)));
    await repo.upsertItems(
      fresh.map((item) => ({
        itemKey: keyOf(item.externalId),
        searchId: search.id,
        title: item.title,
        url: item.url,
        seller: "",
        marketplace: VINTED,
        imageUrl: item.imageUrl ?? "",
        price: item.price,
        shipping: 0,
        currency: "EUR",
        lastTotal: item.price,
      })),
    );
    const keys = fresh.map((item) => keyOf(item.externalId));
    // Premier passage : le stock existant est enregistré sans alerte.
    const baseline = !search.seeded;
    if (baseline) await repo.markSeen(keys, now);
    else await repo.markAlerted(keys, "new", now);
    await repo.updateSearch(search.id, { seeded: true, lastRunAt: now, lastError: null });
    return c.json({ stored: fresh.length, baseline, new: baseline ? [] : fresh });
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

  app.patch("/api/items/:key", async (c) => {
    const patch = await parseBody(c, ItemPatchSchema);
    const item = await repo.updateItem(c.req.param("key"), patch, poller.now());
    if (!item) throw new HttpError(404, "Annonce inconnue");
    return c.json(item);
  });

  app.get("/api/tracked", async (c) => {
    const [tracked, settings] = await Promise.all([repo.trackedItems(), repo.getState()]);
    const body = tracked.map((item) => ({ ...item, maxBidListing: poller.bidAdvice(item, settings) }));
    return c.json(body);
  });

  app.get("/api/settings", async (c) => {
    const { importVatRate, customsFee, reminderMinutes } = await repo.getState();
    return c.json({ importVatRate, customsFee, reminderMinutes } satisfies SettingsDto);
  });

  app.put("/api/settings", async (c) => {
    await repo.setState(await parseBody(c, SettingsSchema));
    const { importVatRate, customsFee, reminderMinutes } = await repo.getState();
    return c.json({ importVatRate, customsFee, reminderMinutes } satisfies SettingsDto);
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
