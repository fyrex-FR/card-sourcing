import { describe, expect, it } from "vitest";
import { callsPerCycle, intervalSeconds } from "../src/alerts/pacing.js";
import { containsWord, evaluate } from "../src/alerts/rules.js";
import type { Item, Search } from "../src/db/schema.js";
import { totalPrice } from "../src/ebay/listing.js";
import type { Listing } from "../src/ebay/listing.js";
import { NOW, makeListing } from "./helpers.js";

function search(overrides: Partial<Search> = {}): Search {
  return {
    id: 1,
    query: "wemby",
    maxPrice: 20,
    buying: "ALL",
    country: null,
    excludes: [],
    endingWindowMin: 60,
    marketplaces: ["EBAY_US"],
    active: true,
    seeded: true,
    createdAt: NOW,
    lastRunAt: null,
    lastError: null,
    ...overrides,
  };
}

function run(options: { search?: Search; newly?: Listing[]; ending?: Listing[]; known?: Item[]; blocked?: string[]; seed?: boolean }) {
  return evaluate({
    search: options.search ?? search(),
    newly: options.newly ?? [],
    ending: options.ending ?? [],
    known: new Map((options.known ?? []).map((item) => [item.itemKey, item])),
    blockedSellers: new Set(options.blocked ?? []),
    now: NOW,
    seed: options.seed ?? false,
    toHome: totalPrice,
  });
}

const known = (itemKey: string, overrides: Partial<Item> = {}): Item => ({
  itemKey,
  searchId: 1,
  title: "",
  url: "",
  seller: "",
  imageUrl: "",
  isAuction: false,
  endAt: null,
  lastTotal: null,
  firstSeenAt: NOW,
  alertedNewAt: null,
  alertedEndingAt: null,
  lastAlertKind: null,
  lastAlertedAt: null,
  muted: false,
  ...overrides,
});

describe("evaluate", () => {
  it("filtre prix port inclus, mots exclus (mots entiers) et vendeurs bloqués", () => {
    const { alerts } = run({
      search: search({ excludes: ["reprint", "rp"] }),
      newly: [
        makeListing("cheap"),
        makeListing("too-expensive", { price: 19, shipping: 5 }),
        makeListing("reprint", { title: "Wemby Prizm REPRINT" }),
        makeListing("rp", { title: "Wemby Prizm RP" }),
        makeListing("sharpie", { title: "Wemby Prizm Sharpie" }),
        makeListing("blocked", { seller: "BadSeller" }),
      ],
      blocked: ["badseller"],
    });
    expect(alerts.map((a) => a.listing.itemKey).sort()).toEqual(["cheap", "sharpie"]);
  });

  it("distingue nouvelle annonce et baisse de prix selon l'âge de l'annonce", () => {
    const { alerts } = run({ newly: [makeListing("old", { createdHoursAgo: 72 }), makeListing("fresh", { createdHoursAgo: 2 })] });
    expect(Object.fromEntries(alerts.map((a) => [a.listing.itemKey, a.kind]))).toEqual({ old: "under", fresh: "new" });
  });

  it("sans prix max, toute nouveauté est « nouvelle »", () => {
    const { alerts } = run({ search: search({ maxPrice: null }), newly: [makeListing("a", { price: 999, createdHoursAgo: 72 })] });
    expect(alerts.map((a) => a.kind)).toEqual(["new"]);
  });

  it("une enchère qui se termine ne produit que l'alerte de fin, en tête de liste", () => {
    const auction = makeListing("auc", { endInMin: 20 });
    const { alerts } = run({ newly: [makeListing("bin"), auction], ending: [auction] });
    expect(alerts.map((a) => [a.kind, a.listing.itemKey])).toEqual([["ending", "auc"], ["new", "bin"]]);
  });

  it("n'alerte pas deux fois, ni pour une carte ignorée", () => {
    const { alerts } = run({
      newly: [makeListing("seen"), makeListing("muted")],
      ending: [makeListing("ended-alerted", { endInMin: 10 })],
      known: [known("seen", { alertedNewAt: NOW }), known("muted", { muted: true }), known("ended-alerted", { alertedEndingAt: NOW })],
    });
    expect(alerts).toEqual([]);
  });

  it("une enchère déjà signalée comme nouvelle peut encore déclencher l'alerte de fin", () => {
    const { alerts } = run({ ending: [makeListing("auc", { endInMin: 30 })], known: [known("auc", { alertedNewAt: NOW })] });
    expect(alerts.map((a) => a.kind)).toEqual(["ending"]);
  });

  it("au premier passage, enregistre l'existant sans alerte mais garde les fins d'enchère", () => {
    const result = run({ seed: true, newly: [makeListing("b", { price: 15 }), makeListing("a", { price: 5 })], ending: [makeListing("auc", { endInMin: 5 })] });
    expect(result.seeded.map((a) => a.listing.itemKey)).toEqual(["a", "b"]);
    expect(result.alerts.map((a) => a.kind)).toEqual(["ending"]);
  });
});

describe("containsWord", () => {
  it("respecte les limites de mots, accents compris", () => {
    expect(containsWord("Carte RP auto", "rp")).toBe(true);
    expect(containsWord("Sharpie", "rp")).toBe(false);
    expect(containsWord("réimpression", "impression")).toBe(false);
  });
});

describe("rythme", () => {
  it("cale l'intervalle sur le budget quotidien", () => {
    const searches = Array.from({ length: 10 }, (_, i) => search({ id: i }));
    expect(callsPerCycle(searches)).toBe(20);
    expect(intervalSeconds(searches, { dailyBudget: 4500, minIntervalSeconds: 120 })).toBe(384);
    expect(intervalSeconds(searches.slice(0, 1), { dailyBudget: 4500, minIntervalSeconds: 120 })).toBe(120);
    expect(callsPerCycle([search({ buying: "FIXED_PRICE", marketplaces: ["EBAY_US", "EBAY_GB"] })])).toBe(2);
  });
});
