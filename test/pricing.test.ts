import { describe, expect, it } from "vitest";
import { fingerprint, landedCost, maxBidFor } from "../src/alerts/pricing.js";

/** 1 EUR = 1,10 USD */
const fx = { convert: (amount: number, from: string, to: string) => (from === to ? amount : from === "USD" ? amount / 1.1 : amount * 1.1) };
const settings = { importVatRate: 0.2, customsFee: 15 };

describe("coût rendu France", () => {
  it("vendeur dans l'UE : carte + port, rien d'autre", () => {
    expect(landedCost({ price: 40, shipping: 5, currency: "EUR", country: "DE" }, fx, "EUR", settings)).toEqual({ goods: 45, importCost: 0, total: 45 });
  });

  it("hors UE : TVA sur carte + port", () => {
    const cost = landedCost({ price: 44, shipping: 11, currency: "USD", country: "CN" }, fx, "EUR", settings)!;
    expect(cost.goods).toBeCloseTo(50);
    expect(cost.importCost).toBeCloseTo(10);
    expect(cost.total).toBeCloseTo(60);
  });

  it("hors UE au-delà de 150 € de marchandise : frais de dédouanement en plus", () => {
    const cost = landedCost({ price: 200, shipping: 0, currency: "EUR", country: "US" }, fx, "EUR", settings)!;
    expect(cost.importCost).toBeCloseTo(40 + 15);
  });

  it("le Royaume-Uni est hors UE", () => {
    expect(landedCost({ price: 10, shipping: 0, currency: "EUR", country: "GB" }, fx, "EUR", settings)!.importCost).toBeCloseTo(2);
  });
});

describe("mise max pour un plafond", () => {
  it.each([
    ["CN, petit plafond", { shipping: 5.5, currency: "USD", country: "CN" }, 60],
    ["CN, au-delà de 150 €", { shipping: 0, currency: "EUR", country: "US" }, 300],
    ["UE", { shipping: 4, currency: "EUR", country: "FR" }, 50],
  ])("%s : le coût rendu de la mise max égale le plafond", (_label, listing, ceiling) => {
    const bid = maxBidFor(ceiling, listing, fx, "EUR", settings)!;
    expect(landedCost({ ...listing, price: bid }, fx, "EUR", settings)!.total).toBeCloseTo(ceiling, 6);
  });

  it("jamais négative", () => {
    expect(maxBidFor(3, { shipping: 10, currency: "EUR", country: "FR" }, fx, "EUR", settings)).toBe(0);
  });
});

describe("empreinte", () => {
  it("ignore casse, ponctuation et accents, mais pas le vendeur", () => {
    expect(fingerprint("Bob", "Wemby Prizm Silver #136 RC!")).toBe(fingerprint("bob", "wemby  prizm silver 136 rc"));
    expect(fingerprint("bob", "Équipe")).toBe(fingerprint("bob", "equipe"));
    expect(fingerprint("alice", "Wemby")).not.toBe(fingerprint("bob", "Wemby"));
  });
});
