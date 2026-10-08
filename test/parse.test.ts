import { describe, expect, it } from "vitest";
import { ParseError, parseAdd, parseExcludes, parsePrice } from "../src/bot/parse.js";

describe("parseAdd", () => {
  it("lit les mots-clés et toutes les options", () => {
    expect(parseAdd("wemby prizm silver max=80,5 type=auction pays=cn fin=30 sites=us,uk -reprint -Lot")).toEqual({
      query: "wemby prizm silver",
      maxPrice: 80.5,
      buying: "AUCTION",
      country: "CN",
      excludes: ["reprint", "lot"],
      endingWindowMin: 30,
      marketplaces: ["EBAY_US", "EBAY_GB"],
    });
  });

  it("applique les valeurs par défaut", () => {
    expect(parseAdd("luka downtown")).toMatchObject({ query: "luka downtown", maxPrice: null, buying: "ALL", marketplaces: null });
  });

  it.each(["max=80", "wemby type=foo", "wemby sites=XX", "wemby pays=FRA", "wemby fin=1", "wemby couleur=bleu"])(
    "refuse « %s »",
    (text) => expect(() => parseAdd(text)).toThrow(ParseError),
  );
});

describe("petits parseurs", () => {
  it("prix", () => {
    expect(parsePrice("65,50 €")).toBe(65.5);
    expect(() => parsePrice("abc")).toThrow(ParseError);
    expect(() => parsePrice("")).toThrow(ParseError);
  });

  it("mots exclus", () => {
    expect(parseExcludes("-Reprint lot  custom")).toEqual(["reprint", "lot", "custom"]);
    expect(parseExcludes("-")).toEqual([]);
  });
});
