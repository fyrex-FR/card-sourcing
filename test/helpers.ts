import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Notifier } from "../src/alerts/notifier.js";
import { Poller } from "../src/alerts/poller.js";
import type { Reminder } from "../src/alerts/reminders.js";
import type { Alert } from "../src/alerts/rules.js";
import { MIGRATIONS_FOLDER } from "../src/db/client.js";
import type { Database } from "../src/db/client.js";
import { Repo } from "../src/db/repo.js";
import * as schema from "../src/db/schema.js";
import type { Search } from "../src/db/schema.js";
import { EbayClient } from "../src/ebay/client.js";
import type { ListingSource, SearchOptions } from "../src/ebay/client.js";
import type { Listing } from "../src/ebay/listing.js";

export const NOW = new Date("2026-10-08T12:00:00Z");

/** Vrai Postgres (PGlite, en mémoire) avec les migrations du projet. */
export async function makeRepo(): Promise<Repo> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return new Repo(db as unknown as Database);
}

export function makeListing(itemKey: string, overrides: Partial<Listing> & { endInMin?: number; createdHoursAgo?: number } = {}): Listing {
  const { endInMin, createdHoursAgo = 1, ...rest } = overrides;
  const auction = endInMin !== undefined;
  return {
    itemKey,
    title: "Wembanyama Prizm Silver",
    url: `https://www.ebay.fr/itm/${itemKey}`,
    imageUrl: "",
    price: 10,
    currency: "USD",
    shipping: 2,
    binPrice: null,
    buyingOptions: auction ? ["AUCTION"] : ["FIXED_PRICE"],
    marketplace: "EBAY_US",
    endAt: auction ? new Date(NOW.getTime() + endInMin * 60_000) : null,
    createdAt: new Date(NOW.getTime() - createdHoursAgo * 3600_000),
    bidCount: auction ? 1 : null,
    seller: "seller1",
    sellerFeedbackPct: null,
    sellerFeedbackScore: null,
    country: "CN",
    condition: "",
    ...rest,
  };
}

/** Faux eBay : renvoie des listes prédéfinies, réutilise les vrais filtres. */
export class FakeSource implements ListingSource {
  newly: Listing[] = [];
  ending: Listing[] = [];
  items = new Map<string, Listing | null>();
  calls: SearchOptions[] = [];
  private readonly filters = new EbayClient({ clientId: "", clientSecret: "", deliveryCountry: "FR" });

  buildFilters = this.filters.buildFilters.bind(this.filters);

  async search(_query: string, options: SearchOptions): Promise<Listing[]> {
    this.calls.push(options);
    return options.sort === "endingSoonest" ? [...this.ending] : [...this.newly];
  }

  async getItem(itemKey: string): Promise<Listing | null> {
    return this.items.get(itemKey) ?? null;
  }
}

export class FakeNotifier implements Notifier {
  alerts: Alert[] = [];
  digests: Alert[][] = [];
  overflows: number[] = [];
  errors: string[] = [];
  reminders: Reminder[] = [];
  failAlerts = false;

  async alert(alert: Alert): Promise<void> {
    if (this.failAlerts) throw new Error("telegram down");
    this.alerts.push(alert);
  }
  async seedDigest(_search: Search, existing: Alert[]): Promise<void> {
    this.digests.push(existing);
  }
  async overflow(_search: Search, skipped: number): Promise<void> {
    this.overflows.push(skipped);
  }
  async searchError(_search: Search, message: string): Promise<void> {
    this.errors.push(message);
  }
  async reminder(reminder: Reminder): Promise<void> {
    this.reminders.push(reminder);
  }
  async rateLimited(): Promise<void> {}
  async budgetReached(): Promise<void> {}
}

/** 1 USD = 1 EUR pour garder les tests lisibles. */
export const parityFx = {
  refresh: async () => {},
  convert: (amount: number) => amount,
};

export async function makePoller(options: { maxAlertsPerSearchCycle?: number } = {}) {
  const repo = await makeRepo();
  const source = new FakeSource();
  const notifier = new FakeNotifier();
  const poller = new Poller({
    repo,
    source,
    fx: parityFx,
    notifier,
    config: { homeCurrency: "EUR", ebayDailyBudget: 4500, minIntervalSeconds: 120, maxAlertsPerSearchCycle: options.maxAlertsPerSearchCycle ?? 10 },
    clock: () => NOW,
  });
  return { repo, source, notifier, poller };
}

export function newSearch(overrides: Partial<schema.NewSearch> = {}): Omit<schema.NewSearch, "id" | "createdAt"> {
  return { query: "wemby", marketplaces: ["EBAY_US"], ...overrides };
}
