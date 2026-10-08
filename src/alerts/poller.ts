import type { Config } from "../config.js";
import type { Repo } from "../db/repo.js";
import { utcDay } from "../db/repo.js";
import type { Search } from "../db/schema.js";
import { EbayError, EbayRateLimitError } from "../ebay/client.js";
import type { ListingSource } from "../ebay/client.js";
import { totalPrice } from "../ebay/listing.js";
import type { Listing } from "../ebay/listing.js";
import { marketplaceCurrency } from "../ebay/marketplaces.js";
import type { Converter } from "../fx.js";
import type { Notifier } from "./notifier.js";
import { callsPerCycle, intervalSeconds } from "./pacing.js";
import { evaluate, watchesEndingAuctions } from "./rules.js";
import type { Evaluation } from "./rules.js";

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
    const active = await this.deps.repo.listSearches({ activeOnly: true });
    return {
      active,
      callsPerCycle: callsPerCycle(active),
      intervalSeconds: this.interval(active),
      callsToday: await this.deps.repo.apiCallsOn(this.now()),
    };
  }

  /** Passage complet sur une recherche. Renvoie le nombre d'alertes envoyées. */
  checkSearch(search: Search): Promise<number> {
    return this.exclusive(() => this.check(search));
  }

  async runCycle(): Promise<number> {
    let sent = 0;
    for (const { id } of await this.deps.repo.listSearches({ activeOnly: true })) {
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
        const active = await repo.listSearches({ activeOnly: true });
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
      await repo.markAlerted(evaluation.seeded.map((alert) => alert.listing.itemKey), "new", this.now());
      await notifier.seedDigest(search, evaluation.seeded);
    }
    return this.deliver(search, evaluation);
  }

  private async evaluate(search: Search, seed: boolean): Promise<Evaluation> {
    const { repo, source, fx, config } = this.deps;
    const now = this.now();
    const newly: Listing[] = [];
    const ending: Listing[] = [];

    for (const marketplace of search.marketplaces) {
      const currency = marketplaceCurrency(marketplace);
      const converted = search.maxPrice === null ? null : fx.convert(search.maxPrice, config.homeCurrency, currency);
      const maxPrice = converted === null ? null : converted * API_PRICE_MARGIN;
      const base = { maxPrice, currency, country: search.country };

      newly.push(...(await this.query(search, marketplace, source.buildFilters({ ...base, buying: search.buying }), "newlyListed", 200)));
      if (watchesEndingAuctions(search)) {
        const endingBefore = new Date(now.getTime() + search.endingWindowMin * 60_000);
        const filters = source.buildFilters({ ...base, buying: "AUCTION", endingBefore });
        ending.push(...(await this.query(search, marketplace, filters, "endingSoonest", 100)));
      }
    }

    const keys = [...new Set([...newly, ...ending].map((listing) => listing.itemKey))];
    const evaluation = evaluate({
      search,
      newly,
      ending,
      known: await repo.getItems(keys),
      blockedSellers: await repo.blockedSellers(),
      now,
      seed,
      toHome: (listing) => fx.convert(totalPrice(listing), listing.currency, config.homeCurrency),
    });
    await repo.upsertItems(
      evaluation.matched.map(({ listing, totalHome }) => ({
        itemKey: listing.itemKey,
        searchId: search.id,
        title: listing.title,
        url: listing.url,
        seller: listing.seller,
        lastTotal: totalHome,
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
      await repo.markAlerted([alert.listing.itemKey], alert.kind === "ending" ? "ending" : "new", this.now());
      sent += 1;
    }
    const overflow = alerts.slice(cap);
    if (overflow.length > 0) {
      for (const kind of ["new", "ending"] as const) {
        const keys = overflow.filter((a) => (a.kind === "ending") === (kind === "ending")).map((a) => a.listing.itemKey);
        await repo.markAlerted(keys, kind, this.now());
      }
      await notifier.overflow(search, overflow.length);
    }
    return sent;
  }
}

function logError(error: unknown): void {
  console.error("[poller]", error instanceof Error ? error.message : error);
}
