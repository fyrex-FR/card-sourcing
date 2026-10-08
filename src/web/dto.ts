/** Types échangés avec l'interface web (dates sérialisées en chaînes ISO). */
import type { AlertHistoryEntry } from "../db/repo.js";
import type { Buying, Search } from "../db/schema.js";
import type { Listing } from "../ebay/listing.js";

export type Json<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Json<U>[]
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;

export type SearchDto = Json<Search>;
export type AlertDto = Json<AlertHistoryEntry>;
export type PreviewItemDto = Json<{ listing: Listing; totalHome: number | null }>;
export type { Buying };

export interface StatusDto {
  paused: boolean;
  lastCycleAt: string | null;
  activeSearches: number;
  callsPerCycle: number;
  intervalSeconds: number;
  callsToday: number;
  dailyBudget: number;
  homeCurrency: string;
  defaultMarketplaces: string[];
  marketplaces: string[];
}

export interface ApiError {
  error: string;
}
