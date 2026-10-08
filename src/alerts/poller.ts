import type { Config } from "../config.js";
import type { Repo } from "../db/repo.js";
import { utcDay } from "../db/repo.js";
import type { ImportSettings, Item, Search } from "../db/schema.js";
import { EbayError, EbayRateLimitError } from "../ebay/client.js";
import type { ListingSource } from "../ebay/client.js";
import { isAuction } from "../ebay/listing.js";
import type { Listing } from "../ebay/listing.js";
import { isVinted, marketplaceCurrency } from "../ebay/marketplaces.js";
import type { Converter } from "../fx.js";
import type { Notifier } from "./notifier.js";
import { callsPerCycle, intervalSeconds } from "./pacing.js";
import { fingerprint, landedCost, maxBidFor } from "./pricing.js";
import { evaluate, matchesSearch, watchesEndingAuctions } from "./rules.js";
import type { Evaluation, SearchCriteria } from "./rules.js";

export type PreviewCriteria = SearchCriteria & Pick<Search, "query" | "buying" | "country" | "marketplaces">;

export interface PreviewItem {
  listing: Listing;
  /** Coût rendu France. */
  totalHome: number | null;
  importCost: number | null;
}

/** Marge sur le prix max envoyé à eBay : son taux de change diffère un peu du nôtre. */
const API_PRICE_MARGIN = 1.05;
const IDLE_MS = 60_000;
const RATE_LIMIT_PAUSE_MIN = 30;

export interface PollerDeps {
  repo: Repo;
  source: ListingSource;
  fx: Converter & { refresh(): Promise<void> };
  notifier: Notifier;
  config: Pick<Config, "homeCurrency" | "ebayDailyBudget" | "minIntervalSeconds" | "maxAlertsPerSearchCycle">;
  clock?: () => Date;
}

export class Poller {
  private readonly clock: () => Date;
  private queue: Promise<unknown> = Promise.resolve();
  private wakeUp: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly deps: PollerDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  now(): Date {
    return this.clock();
  }

  /** Interrompt l'attente en cours (recherche modifiée, reprise…). */
  wake(): void {
    this.wakeUp?.();
  }

  stop(): void {
    this.stopped = true;
    this.wake();
  }

  async status(): Promise<{ active: Search[]; callsPerCycle: number; intervalSeconds: number; callsToday: number }> {
    const active = await this.deps.repo.listSearches({ activeOnly: true, source: "ebay" });
    return {
      active,
      callsPerCycle: callsPerCycle(active),
      intervalSeconds: this.interval(active),
      callsToday: await this.deps.repo.apiCallsOn(this.now()),
    };
  }

  /** Annonces actuellement en ligne qui correspondent à ces critères (sans rien enregistrer). */
  async preview(criteria: PreviewCriteria, limitPerMarketplace = 50): Promise<PreviewItem[]> {
    const { source, fx, repo } = this.deps;
    await fx.refresh();
    const blocked = await repo.blockedSellers();
    const settings = await repo.getState();
    const byKey = new Map<string, PreviewItem>();
    if (isVinted(criteria)) return [];
    for (const marketplace of criteria.marketplaces) {
      const currency = marketplaceCurrency(marketplace);
      const filters = source.buildFilters({
        buying: criteria.buying,
        maxPrice: this.apiMaxPrice(criteria.maxPrice, currency),
        currency,
        country: criteria.country,
      });
      await repo.countApiCalls(this.now());
      const sort = criteria.maxPrice === null ? "newlyListed" : "price";
      for (const listing of await source.search(criteria.query, { marketplace, filters, sort, limit: limitPerMarketplace })) {
        const cost = this.landed(listing, settings);
        if (!byKey.has(listing.itemKey) && matchesSearch(listing, criteria, cost?.total ?? null, blocked)) {
          byKey.set(listing.itemKey, { listing, totalHome: cost?.total ?? null, importCost: cost?.importCost ?? null });
        }
      }
    }
    const items = [...byKey.values()];
    return criteria.maxPrice === null ? items : items.sort((a, b) => (a.totalHome ?? Infinity) - (b.totalHome ?? Infinity));
  }

  /** Passage complet sur une recherche. Renvoie le nombre d'alertes envoyées. */
  checkSearch(search: Search): Promise<number> {
    return this.exclusive(() => this.check(search));
  }

  async runCycle(): Promise<number> {
    let sent = 0;
    for (const { id } of await this.deps.repo.listSearches({ activeOnly: true, source: "ebay" })) {
      // Relue juste avant : elle a pu être modifiée ou supprimée pendant le passage.
      const search = await this.deps.repo.getSearch(id);
      if (search?.active) sent += await this.checkSearch(search);
    }
    await this.deps.repo.setState({ lastCycleAt: this.now() });
    return sent;
  }

  async start(): Promise<void> {
    const { repo, notifier, config } = this.deps;
    while (!this.stopped) {
      try {
        const state = await repo.getState();
        const active = await repo.listSearches({ activeOnly: true, source: "ebay" });
        if (state.paused || active.length === 0) {
          await this.sleep(IDLE_MS);
          continue;
        }
        const used = await repo.apiCallsOn(this.now());
        if (used + callsPerCycle(active) > config.ebayDailyBudget) {
          await this.waitForBudget(used, state.budgetWarnedDay);
          continue;
        }
        await this.runCycle();
        await this.sleep(this.interval(active) * 1000);
      } catch (error) {
        if (error instanceof EbayRateLimitError) {
          await notifier.rateLimited(RATE_LIMIT_PAUSE_MIN).catch(logError);
          await this.sleep(RATE_LIMIT_PAUSE_MIN * 60_000);
        } else {
          logError(error);
          await this.sleep(IDLE_MS);
        }
      }
    }
  }

  // --- interne -------------------------------------------------------------

  /** Coût rendu France d'une annonce, selon les réglages d'import. */
  landed(listing: Listing, settings: ImportSettings) {
    return landedCost(listing, this.deps.fx, this.deps.config.homeCurrency, settings);
  }

  /** Mise max à saisir sur eBay (devise de l'annonce) pour respecter le plafond de la carte. */
  bidAdvice(item: Item, settings: ImportSettings): number | null {
    if (item.maxBid === null || !item.currency) return null;
    return maxBidFor(item.maxBid, { shipping: item.shipping, currency: item.currency, country: item.country }, this.deps.fx, this.deps.config.homeCurrency, settings);
  }

  private apiMaxPrice(maxPrice: number | null, currency: string): number | null {
    if (maxPrice === null) return null;
    const converted = this.deps.fx.convert(maxPrice, this.deps.config.homeCurrency, currency);
    return converted === null ? null : converted * API_PRICE_MARGIN;
  }

  private interval(active: Search[]): number {
    return intervalSeconds(active, {
      dailyBudget: this.deps.config.ebayDailyBudget,
      minIntervalSeconds: this.deps.config.minIntervalSeconds,
    });
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakeUp = done;
    });
  }

  private async waitForBudget(used: number, warnedDay: string | null): Promise<void> {
    const now = this.now();
    if (warnedDay !== utcDay(now)) {
      await this.deps.repo.setState({ budgetWarnedDay: utcDay(now) });
      await this.deps.notifier.budgetReached(used, this.deps.config.ebayDailyBudget).catch(logError);
    }
    await this.sleep(15 * 60_000);
  }

  private async check(search: Search): Promise<number> {
    if (isVinted(search)) return 0;
    const { repo, fx, notifier } = this.deps;
    await fx.refresh();
    const seed = !search.seeded;
    let evaluation: Evaluation;
    try {
      evaluation = await this.evaluate(search, seed);
    } catch (error) {
      if (error instanceof EbayError && !(error instanceof EbayRateLimitError)) {
        if (search.lastError === null) await notifier.searchError(search, error.message).catch(logError);
        await repo.updateSearch(search.id, { lastError: error.message, lastRunAt: this.now() });
        return 0;
      }
      throw error;
    }
    await repo.updateSearch(search.id, { lastError: null, lastRunAt: this.now(), seeded: true });
    if (seed) {
      await repo.markSeen(evaluation.seeded.map((alert) => alert.listing.itemKey), this.now());
      await notifier.seedDigest(search, evaluation.seeded);
    }
    return this.deliver(search, evaluation);
  }

  private async evaluate(search: Search, seed: boolean): Promise<Evaluation> {
    const { repo, source } = this.deps;
    const now = this.now();
    const newly: Listing[] = [];
    const ending: Listing[] = [];

    for (const marketplace of search.marketplaces) {
      const currency = marketplaceCurrency(marketplace);
      const base = { maxPrice: this.apiMaxPrice(search.maxPrice, currency), currency, country: search.country };

      newly.push(...(await this.query(search, marketplace, source.buildFilters({ ...base, buying: search.buying }), "newlyListed", 200)));
      if (watchesEndingAuctions(search)) {
        const endingBefore = new Date(now.getTime() + search.endingWindowMin * 60_000);
        const filters = source.buildFilters({ ...base, buying: "AUCTION", endingBefore });
        ending.push(...(await this.query(search, marketplace, filters, "endingSoonest", 100)));
      }
    }

    const all = [...newly, ...ending];
    const keys = [...new Set(all.map((listing) => listing.itemKey))];
    const fingerprintOf = (listing: Listing) => fingerprint(listing.seller, listing.title);
    const settings = await repo.getState();
    const evaluation = evaluate({
      search,
      newly,
      ending,
      known: await repo.getItems(keys),
      fingerprints: await repo.fingerprintStates([...new Set(all.map(fingerprintOf))], keys),
      fingerprintOf,
      blockedSellers: await repo.blockedSellers(),
      now,
      seed,
      price: (listing) => this.landed(listing, settings),
    });
    await repo.upsertItems(
      evaluation.matched.map(({ listing, totalHome, importCost }) => ({
        itemKey: listing.itemKey,
        searchId: search.id,
        title: listing.title,
        url: listing.url,
        seller: listing.seller,
        fingerprint: fingerprintOf(listing),
        country: listing.country,
        marketplace: listing.marketplace,
        imageUrl: listing.imageUrl,
        isAuction: isAuction(listing),
        endAt: listing.endAt,
        price: listing.price,
        shipping: listing.shipping,
        currency: listing.currency,
        bidCount: listing.bidCount,
        lastTotal: totalHome,
        importCost,
      })),
    );
    return evaluation;
  }

  private async query(
    search: Search,
    marketplace: string,
    filters: string[],
    sort: "newlyListed" | "endingSoonest",
    limit: number,
  ): Promise<Listing[]> {
    await this.deps.repo.countApiCalls(this.now());
    return this.deps.source.search(search.query, { marketplace, filters, sort, limit });
  }

  private async deliver(search: Search, { alerts }: Evaluation): Promise<number> {
    const { repo, notifier, config } = this.deps;
    const cap = config.maxAlertsPerSearchCycle;
    let sent = 0;
    for (const alert of alerts.slice(0, cap)) {
      try {
        await notifier.alert(alert, search);
      } catch (error) {
        // Pas marquée : elle sera retentée au prochain passage.
        logError(error);
        continue;
      }
      await repo.markAlerted([alert.listing.itemKey], alert.kind, this.now());
      sent += 1;
    }
    const overflow = alerts.slice(cap);
    if (overflow.length > 0) {
      // Non envoyées sur Telegram, mais visibles dans l'historique web.
      for (const kind of ["new", "under", "ending"] as const) {
        await repo.markAlerted(overflow.filter((a) => a.kind === kind).map((a) => a.listing.itemKey), kind, this.now());
      }
      await notifier.overflow(search, overflow.length);
    }
    return sent;
  }
}

function logError(error: unknown): void {
  console.error("[poller]", error instanceof Error ? error.message : error);
}
