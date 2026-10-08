import type { Config } from "../config.js";
import type { Repo } from "../db/repo.js";
import type { Item } from "../db/schema.js";
import { EbayRateLimitError } from "../ebay/client.js";
import type { ListingSource } from "../ebay/client.js";
import type { Converter } from "../fx.js";
import type { Notifier } from "./notifier.js";
import { landedCost, maxBidFor } from "./pricing.js";

const TICK_MS = 60_000;

export interface Reminder {
  item: Item;
  /** Enchère en cours (devise de l'annonce), relue sur eBay si possible. */
  price: number | null;
  currency: string;
  bidCount: number | null;
  endAt: Date | null;
  /** Coût rendu France au prix actuel. */
  landed: number | null;
  /** Mise max à saisir sur eBay pour respecter le plafond (devise de l'annonce). */
  maxBidListing: number | null;
  /** L'annonce n'existe plus sur eBay. */
  gone: boolean;
}

export interface ReminderDeps {
  repo: Repo;
  source: ListingSource;
  fx: Converter;
  notifier: Notifier;
  config: Pick<Config, "homeCurrency">;
  clock?: () => Date;
}

/** Rappel Telegram avant la fin des enchères suivies ou à enchérir (1 appel eBay par rappel). */
export class Reminders {
  private readonly clock: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ReminderDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async tick(): Promise<number> {
    const { repo, source, fx, notifier, config } = this.deps;
    const now = this.clock();
    const settings = await repo.getState();
    let sent = 0;
    for (const item of await repo.dueReminders(now, settings.reminderMinutes)) {
      let current = null;
      let gone = false;
      try {
        await repo.countApiCalls(now);
        current = await source.getItem(item.itemKey, item.marketplace);
        gone = current === null;
      } catch (error) {
        if (error instanceof EbayRateLimitError) throw error;
        console.error(`[rappel] lecture eBay ${item.itemKey}:`, error instanceof Error ? error.message : error);
      }
      const currency = current?.currency ?? item.currency ?? config.homeCurrency;
      const listing = {
        price: current?.price ?? item.price ?? 0,
        shipping: current?.shipping ?? item.shipping,
        currency,
        country: item.country,
      };
      const cost = current || item.price !== null ? landedCost(listing, fx, config.homeCurrency, settings) : null;
      const reminder: Reminder = {
        item,
        price: current?.price ?? item.price,
        currency,
        bidCount: current?.bidCount ?? item.bidCount,
        endAt: current?.endAt ?? item.endAt,
        landed: cost?.total ?? null,
        maxBidListing: item.maxBid === null ? null : maxBidFor(item.maxBid, listing, fx, config.homeCurrency, settings),
        gone,
      };
      await notifier.reminder(reminder);
      await repo.markReminded(
        item.itemKey,
        now,
        current
          ? { price: current.price, bidCount: current.bidCount, endAt: current.endAt, lastTotal: cost?.total ?? null, importCost: cost?.importCost ?? null }
          : undefined,
      );
      sent += 1;
    }
    return sent;
  }

  start(): void {
    const run = () =>
      this.tick().catch((error: unknown) => console.error("[rappel]", error instanceof Error ? error.message : error));
    void run();
    this.timer = setInterval(run, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
