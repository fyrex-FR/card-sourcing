export const BUYING_LABEL = { ALL: "Tout", AUCTION: "Enchères", FIXED_PRICE: "Achat immédiat" } as const;

export const MARKETPLACE_LABEL: Record<string, string> = {
  EBAY_US: "🇺🇸 États-Unis",
  EBAY_GB: "🇬🇧 Royaume-Uni",
  EBAY_DE: "🇩🇪 Allemagne",
  EBAY_FR: "🇫🇷 France",
  EBAY_IT: "🇮🇹 Italie",
  EBAY_ES: "🇪🇸 Espagne",
  EBAY_NL: "🇳🇱 Pays-Bas",
  EBAY_BE: "🇧🇪 Belgique",
  EBAY_AT: "🇦🇹 Autriche",
  EBAY_IE: "🇮🇪 Irlande",
  EBAY_CA: "🇨🇦 Canada",
  EBAY_AU: "🇦🇺 Australie",
  EBAY_CH: "🇨🇭 Suisse",
  EBAY_HK: "🇭🇰 Hong Kong",
};

export const SELLER_COUNTRIES: [string, string][] = [
  ["CN", "Chine"],
  ["HK", "Hong Kong"],
  ["JP", "Japon"],
  ["KR", "Corée du Sud"],
  ["TW", "Taïwan"],
  ["US", "États-Unis"],
  ["CA", "Canada"],
  ["GB", "Royaume-Uni"],
  ["DE", "Allemagne"],
  ["FR", "France"],
  ["IT", "Italie"],
  ["ES", "Espagne"],
  ["AU", "Australie"],
];

export function money(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function flag(country: string | null | undefined): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return "";
  return [...country.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "jamais";
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

export function timeLeft(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const minutes = Math.floor((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 0) return "terminée";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}
