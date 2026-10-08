import { createHash } from "node:crypto";
import type { ImportSettings } from "../db/schema.js";
import type { Converter } from "../fx.js";

/** Pays de l'UE : pas de TVA à l'import pour une livraison en France. */
export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE",
  "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/** Au-delà de cette valeur de marchandise, le colis passe en dédouanement classique (frais du transporteur). */
export const CUSTOMS_THRESHOLD = 150;

export interface PricedListing {
  price: number;
  shipping: number | null;
  currency: string;
  country: string;
}

export interface LandedCost {
  /** Carte + port, convertis. */
  goods: number;
  /** TVA et frais d'import. */
  importCost: number;
  /** Coût rendu France. */
  total: number;
}

export const isImported = (country: string) => country !== "" && !EU_COUNTRIES.has(country.toUpperCase());

export function landedCost(listing: PricedListing, fx: Converter, home: string, settings: ImportSettings): LandedCost | null {
  const goods = fx.convert(listing.price + (listing.shipping ?? 0), listing.currency, home);
  const itemValue = fx.convert(listing.price, listing.currency, home);
  if (goods === null || itemValue === null) return null;
  if (!isImported(listing.country)) return { goods, importCost: 0, total: goods };
  const fee = itemValue > CUSTOMS_THRESHOLD ? settings.customsFee : 0;
  const importCost = goods * settings.importVatRate + fee;
  return { goods, importCost, total: goods + importCost };
}

/**
 * Mise maximale à saisir sur eBay (devise de l'annonce) pour que le coût rendu reste sous `ceiling` (devise locale).
 * Inverse de landedCost.
 */
export function maxBidFor(ceiling: number, listing: Omit<PricedListing, "price">, fx: Converter, home: string, settings: ImportSettings): number | null {
  const shipping = fx.convert(listing.shipping ?? 0, listing.currency, home);
  if (shipping === null) return null;
  let bid: number;
  if (!isImported(listing.country)) {
    bid = ceiling - shipping;
  } else {
    bid = ceiling / (1 + settings.importVatRate) - shipping;
    if (bid > CUSTOMS_THRESHOLD) bid = Math.max(CUSTOMS_THRESHOLD, (ceiling - settings.customsFee) / (1 + settings.importVatRate) - shipping);
  }
  return fx.convert(Math.max(0, bid), home, listing.currency);
}

/** Même vendeur + même titre (normalisé) : une carte remise en ligne garde la même empreinte. */
export function fingerprint(seller: string, title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return createHash("sha1").update(`${seller.toLowerCase()}|${normalized}`).digest("hex").slice(0, 20);
}
