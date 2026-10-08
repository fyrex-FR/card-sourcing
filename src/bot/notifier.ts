import type { Api } from "grammy";
import type { Notifier } from "../alerts/notifier.js";
import type { Alert } from "../alerts/rules.js";
import type { Search } from "../db/schema.js";
import { alertCaption, escapeHtml, searchLabel, seedDigest } from "./format.js";
import { alertKeyboard } from "./keyboards.js";

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly api: Api,
    private readonly chatId: string,
    private readonly homeCurrency: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private send(html: string): Promise<unknown> {
    return this.api.sendMessage(this.chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  }

  async alert(alert: Alert, search: Search): Promise<void> {
    const caption = alertCaption(alert, search, this.homeCurrency, this.clock());
    const reply_markup = alertKeyboard(alert.listing.itemKey, alert.listing.url);
    if (alert.listing.imageUrl) {
      try {
        await this.api.sendPhoto(this.chatId, alert.listing.imageUrl, { caption, parse_mode: "HTML", reply_markup });
        return;
      } catch (error) {
        // Image refusée par Telegram (format, taille, URL) : on envoie au moins le texte.
        console.warn("[telegram] photo refusée:", (error as Error).message);
      }
    }
    await this.api.sendMessage(this.chatId, caption, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });
  }

  async seedDigest(search: Search, existing: Alert[]): Promise<void> {
    await this.send(seedDigest(search, existing, this.homeCurrency));
  }

  async overflow(search: Search, skipped: number): Promise<void> {
    await this.send(
      `➕ ${skipped} autres annonces pour <b>${escapeHtml(searchLabel(search))}</b> non envoyées.\n` +
        "La recherche est peut-être trop large : affine-la ou baisse le prix max.",
    );
  }

  async searchError(search: Search, message: string): Promise<void> {
    await this.send(`⚠️ Erreur eBay sur <b>${escapeHtml(searchLabel(search))}</b> : ${escapeHtml(message.slice(0, 300))}`);
  }

  async rateLimited(pauseMinutes: number): Promise<void> {
    await this.send(`⛔ eBay renvoie 429 (quota atteint). Pause de ${pauseMinutes} min.`);
  }

  async budgetReached(used: number, budget: number): Promise<void> {
    await this.send(`⏸ Budget eBay du jour atteint (${used}/${budget} appels). Reprise à minuit UTC.`);
  }
}
