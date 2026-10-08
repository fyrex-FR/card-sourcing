export const MARKETPLACE_CURRENCY: Record<string, string> = {
  EBAY_US: "USD",
  EBAY_GB: "GBP",
  EBAY_DE: "EUR",
  EBAY_FR: "EUR",
  EBAY_IT: "EUR",
  EBAY_ES: "EUR",
  EBAY_NL: "EUR",
  EBAY_BE: "EUR",
  EBAY_AT: "EUR",
  EBAY_IE: "EUR",
  EBAY_CA: "CAD",
  EBAY_AU: "AUD",
  EBAY_CH: "CHF",
  EBAY_HK: "HKD",
};

export const MARKETPLACES = Object.keys(MARKETPLACE_CURRENCY);

/** Recherche surveillée hors eBay, par l'agent OpenClaw (voir /api/vinted). */
export const VINTED = "VINTED";

export const ebaySites = (search: { marketplaces: string[] }): string[] => search.marketplaces.filter((m) => m !== VINTED);
export const isVinted = (search: { marketplaces: string[] }): boolean => search.marketplaces.includes(VINTED);

export function marketplaceCurrency(marketplace: string): string {
  return MARKETPLACE_CURRENCY[marketplace] ?? "USD";
}
