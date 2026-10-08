import type { AlertKind, Item, Search } from "../db/schema.js";
import type { Listing } from "../ebay/listing.js";

export type { AlertKind };

export interface Alert {
  kind: AlertKind;
  listing: Listing;
  /** Prix total (port inclus) converti en devise locale. */
  totalHome: number | null;
}

export interface Evaluation {
  /** Alertes à envoyer, triées (fins d'enchère d'abord). */
  alerts: Alert[];
  /** Premier passage : annonces existantes enregistrées sans alerte. */
  seeded: Alert[];
  /** Toutes les annonces retenues, à enregistrer en base. */
  matched: Alert[];
}

/** Au-delà, une annonce qui passe sous le prix max est une baisse de prix, pas une nouveauté. */
const NEW_LISTING_MAX_AGE_MS = 24 * 3600 * 1000;

export function watchesEndingAuctions(search: Pick<Search, "buying" | "maxPrice">): boolean {
  return search.buying !== "FIXED_PRICE" && search.maxPrice !== null;
}

export function containsWord(title: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(title);
}

export type SearchCriteria = Pick<Search, "maxPrice" | "excludes">;

/** Filtres communs : vendeur bloqué, mots exclus, prix max port inclus. */
export function matchesSearch(listing: Listing, criteria: SearchCriteria, totalHome: number | null, blockedSellers: Set<string>): boolean {
  if (listing.seller && blockedSellers.has(listing.seller.toLowerCase())) return false;
  if (criteria.excludes.some((word) => containsWord(listing.title, word))) return false;
  if (criteria.maxPrice !== null && (totalHome === null || totalHome > criteria.maxPrice)) return false;
  return true;
}

export function evaluate(input: {
  search: Search;
  newly: Listing[];
  ending: Listing[];
  known: Map<string, Item>;
  blockedSellers: Set<string>;
  now: Date;
  seed: boolean;
  toHome: (listing: Listing) => number | null;
}): Evaluation {
  const { search, known, now } = input;
  const alerts: Alert[] = [];
  const seeded: Alert[] = [];
  const matched: Alert[] = [];
  const handled = new Set<string>();

  const passes = (listing: Listing, totalHome: number | null) => matchesSearch(listing, search, totalHome, input.blockedSellers);

  for (const listing of input.ending) {
    if (handled.has(listing.itemKey) || !listing.endAt || listing.endAt <= now) continue;
    const totalHome = input.toHome(listing);
    if (!passes(listing, totalHome)) continue;
    handled.add(listing.itemKey);
    const alert: Alert = { kind: "ending", listing, totalHome };
    matched.push(alert);
    const item = known.get(listing.itemKey);
    if (item?.muted || item?.alertedEndingAt) continue;
    alerts.push(alert);
  }

  for (const listing of input.newly) {
    if (handled.has(listing.itemKey)) continue;
    handled.add(listing.itemKey);
    const totalHome = input.toHome(listing);
    if (!passes(listing, totalHome)) continue;
    const item = known.get(listing.itemKey);
    const fresh = !listing.createdAt || now.getTime() - listing.createdAt.getTime() <= NEW_LISTING_MAX_AGE_MS;
    const alert: Alert = { kind: fresh || search.maxPrice === null ? "new" : "under", listing, totalHome };
    matched.push(alert);
    if (item?.muted || item?.alertedNewAt) continue;
    (input.seed ? seeded : alerts).push(alert);
  }

  const endTime = (alert: Alert) => alert.listing.endAt?.getTime() ?? Infinity;
  alerts.sort((a, b) => {
    if ((a.kind === "ending") !== (b.kind === "ending")) return a.kind === "ending" ? -1 : 1;
    if (a.kind === "ending") return endTime(a) - endTime(b);
    return (a.totalHome ?? Infinity) - (b.totalHome ?? Infinity);
  });
  seeded.sort((a, b) => (a.totalHome ?? Infinity) - (b.totalHome ?? Infinity));
  return { alerts, seeded, matched };
}
