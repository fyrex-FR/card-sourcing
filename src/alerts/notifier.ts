import type { Search } from "../db/schema.js";
import type { Alert } from "./rules.js";

/** Sortie des alertes (Telegram en prod, faux notifier en test). */
export interface Notifier {
  alert(alert: Alert, search: Search): Promise<void>;
  seedDigest(search: Search, existing: Alert[]): Promise<void>;
  overflow(search: Search, skipped: number): Promise<void>;
  searchError(search: Search, message: string): Promise<void>;
  rateLimited(pauseMinutes: number): Promise<void>;
  budgetReached(used: number, budget: number): Promise<void>;
}
