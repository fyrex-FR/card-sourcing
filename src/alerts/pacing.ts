import type { Search } from "../db/schema.js";
import { ebaySites } from "../ebay/marketplaces.js";
import { watchesEndingAuctions } from "./rules.js";

/** Appels Browse API pour un passage complet sur ces recherches. */
export function callsPerCycle(searches: Search[]): number {
  return searches.reduce(
    (total, search) => total + (watchesEndingAuctions(search) ? 2 : 1) * ebaySites(search).length,
    0,
  );
}

/** Intervalle entre deux passages pour tenir dans le budget quotidien. */
export function intervalSeconds(searches: Search[], options: { dailyBudget: number; minIntervalSeconds: number }): number {
  const calls = callsPerCycle(searches);
  if (calls === 0) return options.minIntervalSeconds;
  return Math.max(options.minIntervalSeconds, Math.ceil((86_400 * calls) / options.dailyBudget));
}
