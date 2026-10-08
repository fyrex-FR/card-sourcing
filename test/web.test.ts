import { describe, expect, it } from "vitest";
import { LoginLinks } from "../src/web/auth.js";
import type { LoginChallenge } from "../src/web/auth.js";
import { createWebApp } from "../src/web/server.js";
import { makeListing, makePoller } from "./helpers.js";

async function makeApp() {
  const deps = await makePoller();
  const links = new LoginLinks("https://alertes.test");
  const challenges: LoginChallenge[] = [];
  const app = createWebApp({
    ...deps,
    links,
    sendLoginLink: async (challenge) => void challenges.push(challenge),
    config: { sessionSecret: "secret", publicUrl: "https://alertes.test", homeCurrency: "EUR", defaultMarketplaces: ["EBAY_US"], ebayDailyBudget: 4500 },
    staticRoot: null,
  });
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    return response;
  };
  // Réponses JSON lues librement dans les tests.
  const json = async (method: string, path: string, body?: unknown): Promise<any> => (await call(method, path, body)).json();
  /** Clic sur le bouton de la page de confirmation du lien. */
  const confirmLink = async (url: string) => {
    const response = await app.request("/auth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: new URL(url).searchParams.get("token")! }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    return response;
  };
  const login = async () => {
    await call("POST", "/api/auth/request");
    expect((await confirmLink(challenges.at(-1)!.url)).status).toBe(302);
  };
  return { ...deps, app, call, json, login, confirmLink, challenges };
}

describe("authentification", () => {
  it("bloque l'API sans session mais laisse passer le health check", async () => {
    const { call } = await makeApp();
    expect((await call("GET", "/api/health")).status).toBe(200);
    expect((await call("GET", "/api/searches")).status).toBe(401);
    expect((await call("GET", "/api/me")).status).toBe(401);
  });

  it("connexion par lien : ouvrir le lien ne le consomme pas, le bouton oui, une seule fois", async () => {
    const { call, confirmLink, challenges } = await makeApp();
    await call("POST", "/api/auth/request");
    const url = new URL(challenges[0]!.url);
    expect(url.origin).toBe("https://alertes.test");

    // Un aperçu de lien ou un robot qui charge l'URL ne grille pas le jeton.
    const page = await call("GET", url.pathname + url.search);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('method="post"');
    expect((await call("GET", "/api/me")).status).toBe(401);

    const first = await confirmLink(url.toString());
    expect(first.headers.get("location")).toBe("/");
    const setCookie = first.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect((await call("GET", "/api/me")).status).toBe(200);

    const replay = await confirmLink(url.toString());
    expect(replay.headers.get("location")).toBe("/?login=expired");
  });

  it("connexion par code, avec limite de tentatives", async () => {
    const { call, challenges } = await makeApp();
    await call("POST", "/api/auth/request");
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/auth/code", { code: "000000" === challenges[0]!.code ? "111111" : "000000" })).status).toBe(401);
    // la demande est annulée après 5 échecs, même le bon code est refusé
    expect((await call("POST", "/api/auth/code", { code: challenges[0]!.code })).status).toBe(401);
  });

  it("le bon code ouvre une session", async () => {
    const { call, challenges } = await makeApp();
    await call("POST", "/api/auth/request");
    expect((await call("POST", "/api/auth/code", { code: challenges[0]!.code })).status).toBe(200);
    expect((await call("GET", "/api/me")).status).toBe(200);
    await call("POST", "/api/auth/logout");
    expect((await call("GET", "/api/me")).status).toBe(401);
  });

  it("limite les demandes de lien rapprochées", async () => {
    const { call } = await makeApp();
    expect((await call("POST", "/api/auth/request")).status).toBe(200);
    expect((await call("POST", "/api/auth/request")).status).toBe(429);
  });

  it("refuse un cookie falsifié", async () => {
    const { app } = await makeApp();
    const response = await app.request("/api/me", { headers: { Cookie: `session=${Date.now() + 1e9}.fake` } });
    expect(response.status).toBe(401);
  });
});

describe("API recherches", () => {
  it("crée, valide, modifie, met en pause et supprime", async () => {
    const { call, json, login, repo } = await makeApp();
    await login();

    const invalid = await call("POST", "/api/searches", { query: " ", marketplaces: [] });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toContain("Mots-clés requis");

    const created = await call("POST", "/api/searches", { query: "wemby", maxPrice: 50, country: "cn", excludes: ["Reprint"], marketplaces: ["EBAY_US", "EBAY_US"] });
    expect(created.status).toBe(201);
    const search = (await created.json()) as { id: number };
    expect(search).toMatchObject({ query: "wemby", maxPrice: 50, country: "CN", excludes: ["reprint"], marketplaces: ["EBAY_US"], active: true });

    await repo.updateSearch(search.id, { seeded: true });
    const paused = await json("PATCH", `/api/searches/${search.id}`, { active: false });
    expect(paused).toMatchObject({ active: false, seeded: true });

    const widened = await json("PATCH", `/api/searches/${search.id}`, { maxPrice: 80 });
    expect(widened).toMatchObject({ maxPrice: 80, seeded: false });

    expect((await call("DELETE", `/api/searches/${search.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/searches/${search.id}`)).status).toBe(404);
  });

  it("aperçu : annonces filtrées, triées par prix, sans rien enregistrer", async () => {
    const { json, login, source, repo } = await makeApp();
    await login();
    source.newly = [makeListing("b", { price: 30 }), makeListing("a", { price: 5 }), makeListing("x", { price: 90 }), makeListing("r", { title: "Wemby reprint" })];

    const items = await json("POST", "/api/preview", { query: "wemby", maxPrice: 50, excludes: ["reprint"], marketplaces: ["EBAY_US"] });
    expect(items.map((i: { listing: { itemKey: string } }) => i.listing.itemKey)).toEqual(["a", "b"]);
    expect(source.calls[0]!.sort).toBe("price");
    expect(await repo.getItem("a")).toBeUndefined();
  });

  it("historique des alertes et actions", async () => {
    const { call, json, login, repo, source, poller } = await makeApp();
    await login();
    const search = await repo.createSearch({ query: "wemby", maxPrice: 50, marketplaces: ["EBAY_US"], seeded: true });
    source.newly = [makeListing("a", { imageUrl: "https://img/a.jpg" })];
    await poller.checkSearch(search);

    const [alert] = await json("GET", "/api/alerts");
    expect(alert).toMatchObject({ itemKey: "a", lastAlertKind: "new", imageUrl: "https://img/a.jpg", lastTotal: expect.closeTo(14.4), importCost: expect.closeTo(2.4), search: { id: search.id, query: "wemby" } });

    await call("POST", "/api/items/a/mute");
    await call("POST", "/api/blocked-sellers", { username: "Seller1" });
    expect((await repo.getItem("a"))?.muted).toBe(true);
    expect(await json("GET", "/api/blocked-sellers")).toEqual(["seller1"]);
    await call("DELETE", "/api/blocked-sellers/seller1");
    expect(await json("GET", "/api/blocked-sellers")).toEqual([]);
  });

  it("statut et pause globale", async () => {
    const { call, json, login, repo } = await makeApp();
    await login();
    await repo.createSearch({ query: "a", maxPrice: 10, marketplaces: ["EBAY_US"] });
    const status = await json("GET", "/api/status");
    expect(status).toMatchObject({ paused: false, activeSearches: 1, callsPerCycle: 2, intervalSeconds: 120, dailyBudget: 4500 });
    await call("PUT", "/api/state", { paused: true });
    expect((await json("GET", "/api/status")).paused).toBe(true);
  });

  it("suivi d'une carte : statut, plafond et mise max conseillée", async () => {
    const { call, json, login, repo, source, poller } = await makeApp();
    await login();
    const search = await repo.createSearch({ query: "wemby", maxPrice: 50, marketplaces: ["EBAY_US"], seeded: true });
    source.newly = [makeListing("a", { endInMin: 600, shipping: 5 })];
    await poller.checkSearch(search);

    expect((await call("PATCH", "/api/items/a", { status: "nope" })).status).toBe(400);
    const updated = await json("PATCH", "/api/items/a", { status: "bid", maxBid: 36, note: "pour le client" });
    expect(updated).toMatchObject({ status: "bid", maxBid: 36, note: "pour le client" });

    const [tracked] = await json("GET", "/api/tracked");
    expect(tracked).toMatchObject({ itemKey: "a", status: "bid" });
    expect(tracked.maxBidListing).toBeCloseTo(25);

    await call("PATCH", "/api/items/a", { status: null });
    expect(await json("GET", "/api/tracked")).toEqual([]);
  });

  it("réglages d'import", async () => {
    const { call, json, login } = await makeApp();
    await login();
    expect(await json("GET", "/api/settings")).toEqual({ importVatRate: 0.2, customsFee: 0, reminderMinutes: 10 });
    expect((await call("PUT", "/api/settings", { importVatRate: 2 })).status).toBe(400);
    expect(await json("PUT", "/api/settings", { customsFee: 15, reminderMinutes: 5 })).toEqual({ importVatRate: 0.2, customsFee: 15, reminderMinutes: 5 });
  });

  it("filtres avancés d'une recherche", async () => {
    const { json, login } = await makeApp();
    await login();
    const created = await json("POST", "/api/searches", {
      query: "wemby",
      marketplaces: ["EBAY_US"],
      requiredWords: ["Auto"],
      grading: "RAW",
      excludeLots: true,
      minSellerFeedbackPct: 98,
    });
    expect(created).toMatchObject({ requiredWords: ["auto"], grading: "RAW", excludeLots: true, minSellerFeedbackPct: 98, minSellerFeedbackScore: null });
    const patched = await json("PATCH", `/api/searches/${created.id}`, { grading: "GRADED" });
    expect(patched).toMatchObject({ grading: "GRADED", requiredWords: ["auto"], excludeLots: true });
  });
});
