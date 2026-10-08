import { describe, expect, it } from "vitest";
import { callsPerCycle, intervalSeconds } from "../src/alerts/pacing.js";
import { containsWord, evaluate, isGraded, isLot } from "../src/alerts/rules.js";
import type { FingerprintState } from "../src/alerts/rules.js";
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
    requiredWords: [],
    grading: "ANY",
    excludeLots: false,
    minSellerFeedbackPct: null,
    minSellerFeedbackScore: null,
    endingWindowMin: 60,
    marketplaces: ["EBAY_US"],
    active: true,
    seeded: true,
    vintedSeeded: false,
    createdAt: NOW,
    lastRunAt: null,
    lastError: null,
    ...overrides,
  };
}

function run(options: {
  search?: Search;
  newly?: Listing[];
  ending?: Listing[];
  known?: Item[];
  fingerprints?: Record<string, FingerprintState>;
  blocked?: string[];
  seed?: boolean;
}) {
  return evaluate({
    search: options.search ?? search(),
    newly: options.newly ?? [],
    ending: options.ending ?? [],
    known: new Map((options.known ?? []).map((item) => [item.itemKey, item])),
    fingerprints: new Map(Object.entries(options.fingerprints ?? {})),
    fingerprintOf: (listing) => `${listing.seller}|${listing.title}`,
    blockedSellers: new Set(options.blocked ?? []),
    now: NOW,
    seed: options.seed ?? false,
    price: (listing) => ({ total: totalPrice(listing), importCost: 0 }),
  });
}

const known = (itemKey: string, overrides: Partial<Item> = {}): Item => ({
  itemKey,
  searchId: 1,
  title: "",
  url: "",
  seller: "",
  fingerprint: null,
  country: "",
  marketplace: "EBAY_US",
  imageUrl: "",
  isAuction: false,
  endAt: null,
  price: null,
  shipping: null,
  currency: null,
  bidCount: null,
  lastTotal: null,
  importCost: null,
  firstSeenAt: NOW,
  alertedNewAt: null,
  alertedEndingAt: null,
  lastAlertKind: null,
  lastAlertedAt: null,
  muted: false,
  status: null,
  statusChangedAt: null,
  maxBid: null,
  note: null,
  remindedAt: null,
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

describe("filtres avancés", () => {
  it("mots obligatoires", () => {
    const { alerts } = run({
      search: search({ requiredWords: ["auto"] }),
      newly: [makeListing("a", { title: "Wemby Prizm Auto /99" }), makeListing("b", { title: "Wemby Prizm Silver" })],
    });
    expect(alerts.map((a) => a.listing.itemKey)).toEqual(["a"]);
  });

  it("gradée ou brute", () => {
    const listings = [
      makeListing("psa", { title: "Wemby Prizm PSA 10" }),
      makeListing("cond", { title: "Wemby Prizm", condition: "Graded" }),
      makeListing("raw", { title: "Wemby Prizm Silver", condition: "Ungraded" }),
    ];
    expect(run({ search: search({ grading: "GRADED" }), newly: listings }).alerts.map((a) => a.listing.itemKey).sort()).toEqual(["cond", "psa"]);
    expect(run({ search: search({ grading: "RAW" }), newly: listings }).alerts.map((a) => a.listing.itemKey)).toEqual(["raw"]);
  });

  it("lots et vendeurs peu notés", () => {
    const { alerts } = run({
      search: search({ excludeLots: true, minSellerFeedbackPct: 98, minSellerFeedbackScore: 50 }),
      newly: [
        makeListing("ok", { sellerFeedbackPct: "99.5", sellerFeedbackScore: 120 }),
        makeListing("lot", { title: "Lot of 10 cards Wemby", sellerFeedbackPct: "99.5", sellerFeedbackScore: 120 }),
        makeListing("pct", { sellerFeedbackPct: "95.0", sellerFeedbackScore: 120 }),
        makeListing("new-seller", { sellerFeedbackPct: "100", sellerFeedbackScore: 3 }),
      ],
    });
    expect(alerts.map((a) => a.listing.itemKey)).toEqual(["ok"]);
  });

  it("détecteurs", () => {
    expect(isGraded({ title: "BGS 9.5 Wemby", condition: "" })).toBe(true);
    expect(isGraded({ title: "Wemby PSA", condition: "" })).toBe(false);
    expect(isLot("3 cards wemby")).toBe(true);
    expect(isLot("Wemby Slot")).toBe(false);
  });
});

describe("remises en ligne", () => {
  const relisted = makeListing("new-id", { title: "Wemby Prizm" });
  const fp = "seller1|Wemby Prizm";

  it("une carte déjà signalée, remise en ligne sous un autre ID, n'alerte plus", () => {
    expect(run({ newly: [relisted], fingerprints: { [fp]: { muted: false, alerted: true } } }).alerts).toEqual([]);
  });

  it("une carte ignorée reste ignorée, même pour la fin d'enchère", () => {
    const auction = makeListing("auc", { title: "Wemby Prizm", endInMin: 20 });
    expect(run({ ending: [auction], fingerprints: { [fp]: { muted: true, alerted: false } } }).alerts).toEqual([]);
  });

  it("une carte remise en ligne mais jamais signalée alerte normalement", () => {
    expect(run({ newly: [relisted], fingerprints: { [fp]: { muted: false, alerted: false } } }).alerts).toHaveLength(1);
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
