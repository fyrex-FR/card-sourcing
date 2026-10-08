import { InlineKeyboard } from "grammy";
import type { Buying, Search } from "../db/schema.js";
import { BUYING_LABEL } from "./format.js";

const NEXT_BUYING: Record<Buying, Buying> = { ALL: "AUCTION", AUCTION: "FIXED_PRICE", FIXED_PRICE: "ALL" };

export function alertKeyboard(itemKey: string, url: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("🔗 Voir sur eBay", url)
    .text("⭐ Suivre", `watch:${itemKey}`)
    .row()
    .text("🙈 Ignorer", `mute:${itemKey}`)
    .text("🚫 Bloquer vendeur", `block:${itemKey}`);
}

export function reminderKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().url("🔨 Enchérir sur eBay", url);
}

export function handledAlertKeyboard(url: string, label: string): InlineKeyboard {
  return new InlineKeyboard().url("🔗 Voir sur eBay", url).row().text(label, "noop");
}

export function searchKeyboard(search: Search): InlineKeyboard {
  const id = search.id;
  const next = NEXT_BUYING[search.buying];
  return new InlineKeyboard()
    .text("💶 Prix max", `edit:${id}:max`)
    .text(`🔁 Type → ${BUYING_LABEL[next]}`, `type:${id}:${next}`)
    .row()
    .text("✏️ Mots-clés", `edit:${id}:query`)
    .text("🚫 Mots exclus", `edit:${id}:excludes`)
    .row()
    .text("🌍 Pays vendeur", `edit:${id}:country`)
    .text("🛒 Sites eBay", `edit:${id}:sites`)
    .row()
    .text("⏰ Fenêtre fin", `edit:${id}:window`)
    .text("🔍 Vérifier", `run:${id}`)
    .row()
    .text(search.active ? "⏸ Pause" : "▶️ Reprendre", `toggle:${id}`)
    .text("🗑 Supprimer", `del:${id}`);
}

export function confirmDeleteKeyboard(searchId: number): InlineKeyboard {
  return new InlineKeyboard().text("Oui, supprimer", `del:${searchId}:ok`).text("Annuler", "noop");
}

export function blockedSellersKeyboard(sellers: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const seller of sellers.slice(0, 30)) keyboard.text(`✖️ Débloquer ${seller}`, `unblock:${seller}`.slice(0, 64)).row();
  return keyboard;
}
