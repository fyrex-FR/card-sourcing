import type { Alert, AlertKind } from "../alerts/rules.js";
import type { Search } from "../db/schema.js";
import type { Reminder } from "../alerts/reminders.js";
import { isAuction, totalPrice } from "../ebay/listing.js";

export const BUYING_LABEL = { ALL: "Tout", AUCTION: "Enchères", FIXED_PRICE: "Achat immédiat" } as const;

const ALERT_HEADER: Record<AlertKind, string> = {
  new: "🆕 <b>Nouvelle annonce</b>",
  under: "📉 <b>Sous ton prix max</b>",
  ending: "⏰ <b>Enchère pas chère qui se termine</b>",
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function money(amount: number | null, currency: string): string {
  if (amount === null) return "?";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function flag(country: string): string {
  if (!/^[A-Za-z]{2}$/.test(country)) return "";
  return [...country.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

export function timeLeft(endAt: Date | null, now: Date): string {
  if (!endAt) return "";
  const minutes = Math.floor((endAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "terminée";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

export const searchLabel = (search: Pick<Search, "id" | "query">) => `#${search.id} ${search.query}`;

/** « 💶 52,80 € rendu France (38 $ + port 6 $ + import 8,80 €) » */
export function priceLine(
  listing: { price: number; shipping: number | null; currency: string },
  totalHome: number | null,
  importCost: number | null,
  homeCurrency: string,
): string {
  const shipping = listing.shipping === null ? "port inconnu" : `port ${money(listing.shipping, listing.currency)}`;
  const parts = [money(listing.price, listing.currency), shipping];
  if (importCost) parts.push(`TVA/import ${money(importCost, homeCurrency)}`);
  const total = totalHome === null ? money(listing.price + (listing.shipping ?? 0), listing.currency) : money(totalHome, homeCurrency);
  return `💶 <b>${total}</b>${importCost ? " rendu France" : ""}  <i>(${parts.join(" + ")})</i>`;
}

export function alertCaption(alert: Alert, search: Search, homeCurrency: string, now: Date): string {
  const { listing, totalHome } = alert;
  const lines = [`${ALERT_HEADER[alert.kind]} · ${escapeHtml(searchLabel(search))}`, "", `<b>${escapeHtml(listing.title.slice(0, 200))}</b>`, ""];

  lines.push(priceLine(listing, totalHome, alert.importCost, homeCurrency));

  if (isAuction(listing)) {
    const bids = listing.bidCount ?? 0;
    const parts = [`🔨 Enchère · ${bids} offre${bids > 1 ? "s" : ""}`];
    if (listing.endAt) parts.push(`fin dans <b>${timeLeft(listing.endAt, now)}</b>`);
    if (listing.binPrice !== null) parts.push(`achat immédiat ${money(listing.binPrice, listing.currency)}`);
    lines.push(parts.join(" · "));
  } else {
    lines.push(`🛒 Achat immédiat${listing.buyingOptions.includes("BEST_OFFER") ? " · offre possible" : ""}`);
  }

  const feedback = [listing.sellerFeedbackPct && `${listing.sellerFeedbackPct}%`, listing.sellerFeedbackScore?.toString()].filter(Boolean);
  let sellerLine = `👤 ${escapeHtml(listing.seller || "vendeur inconnu")}`;
  if (feedback.length > 0) sellerLine += ` (${feedback.join(" · ")})`;
  if (listing.country) sellerLine += ` · ${flag(listing.country)} ${listing.country}`;
  lines.push(sellerLine);
  if (listing.condition) lines.push(`🏷 ${escapeHtml(listing.condition)}`);
  return lines.join("\n").slice(0, 1024);
}

export function searchSummary(search: Search, homeCurrency: string): string {
  const lines = [
    `<b>${escapeHtml(searchLabel(search))}</b> — ${search.active ? "✅ active" : "⏸ en pause"}`,
    `Prix max (port inclus) : <b>${search.maxPrice === null ? "aucun" : money(search.maxPrice, homeCurrency)}</b>`,
    `Type : ${BUYING_LABEL[search.buying]}`,
    `Sites eBay : ${search.marketplaces.map((m) => m.slice(5)).join(", ")}`,
  ];
  if (search.country) lines.push(`Vendeur situé en : ${flag(search.country)} ${search.country}`);
  if (search.excludes.length > 0) lines.push(`Mots exclus : ${search.excludes.map(escapeHtml).join(", ")}`);
  if (search.buying !== "FIXED_PRICE") {
    lines.push(
      search.maxPrice === null
        ? "Alerte fin d'enchère : désactivée (définis un prix max)"
        : `Alerte fin d'enchère : ${search.endingWindowMin} min avant la fin si ≤ prix max`,
    );
  }
  if (search.lastError) lines.push(`⚠️ Dernière erreur : ${escapeHtml(search.lastError.slice(0, 200))}`);
  return lines.join("\n");
}

export function searchListLine(search: Search, homeCurrency: string): string {
  const max = search.maxPrice === null ? "pas de max" : money(search.maxPrice, homeCurrency);
  return `${search.active ? "✅" : "⏸"} /s${search.id} ${escapeHtml(search.query)} — ${max} · ${BUYING_LABEL[search.buying]}${search.lastError ? " ⚠️" : ""}`;
}

export function seedDigest(search: Search, existing: Alert[], homeCurrency: string): string {
  const label = `<b>${escapeHtml(searchLabel(search))}</b>`;
  if (existing.length === 0) {
    return `🔎 ${label} est surveillée. Aucune annonce actuelle ne correspond : tu seras alerté dès qu'une apparaît.`;
  }
  const plural = existing.length > 1;
  const lines = [
    `🔎 ${label} est surveillée.`,
    `${existing.length} annonce${plural ? "s" : ""} existe${plural ? "nt" : ""} déjà (pas d'alerte pour elles). Les moins chères :`,
    "",
    ...existing.slice(0, 5).map(({ listing, totalHome }) => {
      const price = totalHome === null ? money(totalPrice(listing), listing.currency) : money(totalHome, homeCurrency);
      return `• <a href="${escapeHtml(listing.url)}">${escapeHtml(listing.title.slice(0, 70))}</a> — <b>${price}</b>`;
    }),
    "",
    "À partir de maintenant, seules les nouveautés te sont envoyées.",
  ];
  return lines.join("\n");
}

export function reminderMessage(reminder: Reminder, homeCurrency: string, now: Date): string {
  const { item } = reminder;
  const status = item.status === "bid" ? "🎯 Enchère à jouer" : "⭐ Enchère suivie";
  const lines = [`⏰ <b>Fin dans ${timeLeft(reminder.endAt, now) || "quelques minutes"}</b> · ${status}`, "", `<b>${escapeHtml(item.title.slice(0, 200))}</b>`, ""];
  if (reminder.gone) {
    lines.push("Cette annonce n'est plus disponible sur eBay.");
    return lines.join("\n");
  }
  if (reminder.price !== null) {
    const bids = reminder.bidCount ?? 0;
    lines.push(`🔨 Enchère actuelle : <b>${money(reminder.price, reminder.currency)}</b> · ${bids} offre${bids > 1 ? "s" : ""}`);
  }
  if (reminder.landed !== null) lines.push(`💶 Coût rendu France à ce prix : <b>${money(reminder.landed, homeCurrency)}</b>`);
  if (item.maxBid !== null) {
    lines.push(`🎯 Ton plafond : ${money(item.maxBid, homeCurrency)} rendu France`);
    if (reminder.maxBidListing !== null) {
      const over = reminder.price !== null && reminder.price > reminder.maxBidListing;
      lines.push(
        over
          ? `⚠️ Déjà au-dessus : la mise max pour ton plafond serait ${money(reminder.maxBidListing, reminder.currency)}.`
          : `👉 Mise max à saisir sur eBay : <b>${money(reminder.maxBidListing, reminder.currency)}</b>`,
      );
    }
  }
  if (item.note) lines.push(`📝 ${escapeHtml(item.note)}`);
  return lines.join("\n");
}

export function loginMessage({ url, code }: { url: string; code: string }): string {
  return [
    `🔐 <a href="${escapeHtml(url)}">Se connecter à l'interface web</a>`,
    `ou tape ce code sur la page de connexion : <code>${code}</code>`,
    "",
    "Valable 10 min, une seule fois. Si tu n'as rien demandé, ignore ce message.",
  ].join("\n");
}

export function helpText(homeCurrency: string, defaultMarketplaces: string[]): string {
  return `<b>Alerteur eBay</b> — je surveille eBay et je t'écris quand une carte qui t'intéresse apparaît.

💻 Tout se règle aussi depuis l'interface web : /login pour recevoir un lien de connexion.

<b>Créer une recherche</b>
<code>/add wembanyama prizm silver max=80 type=auction -reprint -lot</code>

Options (toutes facultatives) :
• <code>max=80</code> prix max <b>port inclus</b>, en ${homeCurrency}
• <code>type=auction</code> | <code>bin</code> | <code>all</code> (défaut : all)
• <code>pays=CN</code> uniquement les vendeurs situés dans ce pays
• <code>fin=60</code> alerte X min avant la fin d'une enchère (défaut 60)
• <code>sites=US,GB,DE</code> sites eBay interrogés (défaut : ${defaultMarketplaces.map((m) => m.slice(5)).join(", ")})
• <code>-mot</code> exclut les titres contenant ce mot

<b>Tu reçois une alerte quand</b>
🆕 une nouvelle annonce correspond (≤ prix max si défini)
📉 une annonce plus ancienne passe sous ton prix max
⏰ une enchère ≤ prix max se termine bientôt

<b>Gérer</b>
/list puis touche une recherche (<code>/s3</code>) pour la modifier, la mettre en pause ou la supprimer.
Sur chaque alerte : 🙈 Ignorer (plus d'alerte pour cette carte) ou 🚫 Bloquer le vendeur.`;
}
