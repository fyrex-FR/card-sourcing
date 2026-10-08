import { describe, expect, it } from "vitest";
import { alertCaption, flag, seedDigest } from "../src/bot/format.js";
import { NOW, makeListing } from "./helpers.js";

const search = { id: 1, query: "wemby", country: null, marketplaces: ["EBAY_US"], buying: "all", maxPrice: null, excludes: [], active: true, endingWindowMin: 60, lastError: null } as never;

describe("pays vendeur", () => {
  it("convertit un code ISO en drapeau, sinon rien", () => {
    expect(flag("FR")).toBe("🇫🇷");
    expect(flag("cn")).toBe("🇨🇳");
    expect(flag("")).toBe("");
    expect(flag("France")).toBe("");
  });

  it("affiche le drapeau dans l'alerte et dans la liste", () => {
    const listing = makeListing("a", { country: "CN" });
    const caption = alertCaption({ kind: "new", listing, totalHome: 10, importCost: 0 } as never, search, "EUR", NOW);
    expect(caption).toContain("🇨🇳 CN");
    expect(seedDigest(search, [{ listing, totalHome: 10 } as never], "EUR")).toContain("• 🇨🇳 <a href");
  });

  it("reste propre sans pays", () => {
    const listing = makeListing("b", { country: "" });
    const caption = alertCaption({ kind: "new", listing, totalHome: 10, importCost: 0 } as never, search, "EUR", NOW);
    expect(caption).not.toMatch(/·\s*$/m);
    expect(seedDigest(search, [{ listing, totalHome: 10 } as never], "EUR")).toContain("• <a href");
  });
});
