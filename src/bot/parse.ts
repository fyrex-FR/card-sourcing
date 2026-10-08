import type { Buying } from "../db/schema.js";
import { MARKETPLACES } from "../ebay/marketplaces.js";

export class ParseError extends Error {}

export interface ParsedSearch {
  query: string;
  maxPrice: number | null;
  buying: Buying;
  country: string | null;
  excludes: string[];
  endingWindowMin: number;
  marketplaces: string[] | null;
}

const TYPE_ALIASES: Record<string, Buying> = {
  all: "ALL",
  tout: "ALL",
  auction: "AUCTION",
  enchere: "AUCTION",
  "enchère": "AUCTION",
  encheres: "AUCTION",
  "enchères": "AUCTION",
  bin: "FIXED_PRICE",
  fixed: "FIXED_PRICE",
  achat: "FIXED_PRICE",
};

export function parsePrice(raw: string): number {
  const value = Number(raw.replace(/[€$\s]/g, "").replace(",", "."));
  if (!Number.isFinite(value) || raw.trim() === "") throw new ParseError(`Prix invalide : ${raw}`);
  if (value < 0) throw new ParseError("Le prix doit être positif");
  return value;
}

export function parseMarketplaces(raw: string): string[] {
  const codes = raw
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => (part.startsWith("EBAY_") ? part : `EBAY_${part}`))
    .map((code) => (code === "EBAY_UK" ? "EBAY_GB" : code));
  if (codes.length === 0) throw new ParseError("Aucune marketplace indiquée");
  const unknown = codes.find((code) => !MARKETPLACES.includes(code));
  if (unknown) {
    throw new ParseError(`Marketplace inconnue : ${unknown.slice(5)}. Possibles : ${MARKETPLACES.map((m) => m.slice(5)).join(", ")}`);
  }
  return [...new Set(codes)];
}

export function parseCountry(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (["", "-", "ALL", "TOUS"].includes(value)) return null;
  if (!/^[A-Z]{2}$/.test(value)) throw new ParseError("Code pays sur 2 lettres attendu (ex : CN)");
  return value;
}

export function parseWindow(raw: string): number {
  const value = Number(raw.trim().replace(/\s*min$/i, ""));
  if (!Number.isInteger(value)) throw new ParseError("Nombre de minutes attendu");
  if (value < 5 || value > 1440) throw new ParseError("Entre 5 et 1440 minutes");
  return value;
}

export function parseExcludes(raw: string): string[] {
  if (raw.trim() === "-") return [];
  return raw
    .split(/\s+/)
    .map((word) => word.replace(/^-+/, "").toLowerCase())
    .filter(Boolean);
}

/** `/add wemby prizm max=80 type=auction pays=CN fin=30 sites=US,GB -reprint` */
export function parseAdd(text: string): ParsedSearch {
  const parsed: ParsedSearch = {
    query: "",
    maxPrice: null,
    buying: "ALL",
    country: null,
    excludes: [],
    endingWindowMin: 60,
    marketplaces: null,
  };
  const words: string[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const option = /^([a-zà-ü]+)=(.+)$/i.exec(token);
    if (option) {
      const key = option[1]!.toLowerCase();
      const value = option[2]!;
      if (key === "max" || key === "prix") parsed.maxPrice = parsePrice(value);
      else if (key === "type") {
        const buying = TYPE_ALIASES[value.toLowerCase()];
        if (!buying) throw new ParseError("type= attend auction, bin ou all");
        parsed.buying = buying;
      } else if (key === "pays" || key === "country") parsed.country = parseCountry(value);
      else if (key === "fin") parsed.endingWindowMin = parseWindow(value);
      else if (key === "sites" || key === "site") parsed.marketplaces = parseMarketplaces(value);
      else throw new ParseError(`Option inconnue : ${key}=`);
    } else if (token.startsWith("-") && token.length > 1) {
      parsed.excludes.push(token.slice(1).toLowerCase());
    } else {
      words.push(token);
    }
  }
  parsed.query = words.join(" ");
  if (!parsed.query) throw new ParseError("Il manque les mots-clés. Exemple : /add wembanyama prizm silver max=80");
  return parsed;
}
