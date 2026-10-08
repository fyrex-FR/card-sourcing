import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { apiUsage, appState, blockedSellers, items, searches } from "./schema.js";
import type { AlertKind, AppState, Item, NewSearch, Search, TrackStatus } from "./schema.js";

export type SearchPatch = Partial<Omit<NewSearch, "id" | "createdAt">>;

export type ItemUpsert = Pick<Item, "itemKey" | "searchId" | "title" | "url" | "seller" | "lastTotal"> &
  Partial<
    Pick<
      Item,
      "imageUrl" | "isAuction" | "endAt" | "fingerprint" | "country" | "marketplace" | "price" | "shipping" | "currency" | "bidCount" | "importCost"
    >
  >;

export type ItemPatch = Partial<Pick<Item, "status" | "maxBid" | "note">>;

export type ItemPriceUpdate = Pick<Item, "price" | "bidCount" | "endAt" | "lastTotal" | "importCost">;

export type AlertHistoryEntry = Item & { search: Pick<Search, "id" | "query"> | null };

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Toutes les lectures/écritures en base passent par ici. */
export class Repo {
  constructor(private readonly db: Database) {}

  // --- recherches ---------------------------------------------------------

  async createSearch(values: Omit<NewSearch, "id" | "createdAt">): Promise<Search> {
    const [row] = await this.db.insert(searches).values(values).returning();
    return row!;
  }

  async getSearch(id: number): Promise<Search | undefined> {
    const [row] = await this.db.select().from(searches).where(eq(searches.id, id));
    return row;
  }

  /** `source` : "ebay" garde celles qui ont au moins un site eBay, "vinted" celles qui incluent Vinted. */
  async listSearches(options: { activeOnly?: boolean; source?: "ebay" | "vinted" } = {}): Promise<Search[]> {
    const isVinted = sql`'VINTED' = ANY(${searches.marketplaces})`;
    const hasEbay = sql`EXISTS (SELECT 1 FROM unnest(${searches.marketplaces}) AS m WHERE m <> 'VINTED')`;
    return this.db
      .select()
      .from(searches)
      .where(
        and(
          options.activeOnly ? eq(searches.active, true) : undefined,
          options.source === "ebay" ? hasEbay : options.source === "vinted" ? isVinted : undefined,
        ),
      )
      .orderBy(asc(searches.id));
  }

  async updateSearch(id: number, patch: SearchPatch): Promise<Search | undefined> {
    const [row] = await this.db.update(searches).set(patch.seeded === false ? { ...patch, vintedSeeded: false } : patch).where(eq(searches.id, id)).returning();
    return row;
  }

  async deleteSearch(id: number): Promise<boolean> {
    const rows = await this.db.delete(searches).where(eq(searches.id, id)).returning({ id: searches.id });
    return rows.length > 0;
  }

  // --- annonces -----------------------------------------------------------

  async getItem(itemKey: string): Promise<Item | undefined> {
    const [row] = await this.db.select().from(items).where(eq(items.itemKey, itemKey));
    return row;
  }

  async getItems(itemKeys: string[]): Promise<Map<string, Item>> {
    if (itemKeys.length === 0) return new Map();
    const rows = await this.db.select().from(items).where(inArray(items.itemKey, itemKeys));
    return new Map(rows.map((row) => [row.itemKey, row]));
  }

  async upsertItems(rows: ItemUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(items)
      .values(rows)
      .onConflictDoUpdate({
        target: items.itemKey,
        set: {
          title: sql`excluded.title`,
          fingerprint: sql`excluded.fingerprint`,
          imageUrl: sql`excluded.image_url`,
          endAt: sql`excluded.end_at`,
          price: sql`excluded.price`,
          shipping: sql`excluded.shipping`,
          currency: sql`excluded.currency`,
          bidCount: sql`excluded.bid_count`,
          lastTotal: sql`excluded.last_total`,
          importCost: sql`excluded.import_cost`,
        },
      });
  }

  /** Annonce signalée : n'alertera plus pour ce motif. */
  async markAlerted(itemKeys: string[], kind: AlertKind, at: Date): Promise<void> {
    if (itemKeys.length === 0) return;
    await this.db
      .update(items)
      .set({ alertedNewAt: at, lastAlertKind: kind, lastAlertedAt: at, ...(kind === "ending" ? { alertedEndingAt: at } : {}) })
      .where(inArray(items.itemKey, itemKeys));
  }

  /** Annonce existante au premier passage : vue, sans alerte. */
  async markSeen(itemKeys: string[], at: Date): Promise<void> {
    if (itemKeys.length === 0) return;
    await this.db.update(items).set({ alertedNewAt: at }).where(inArray(items.itemKey, itemKeys));
  }

  async alertHistory(limit: number): Promise<AlertHistoryEntry[]> {
    const rows = await this.db
      .select({ item: items, searchId: searches.id, searchQuery: searches.query })
      .from(items)
      .leftJoin(searches, eq(items.searchId, searches.id))
      .where(isNotNull(items.lastAlertedAt))
      .orderBy(desc(items.lastAlertedAt))
      .limit(limit);
    return rows.map(({ item, searchId, searchQuery }) => ({
      ...item,
      search: searchId === null || searchQuery === null ? null : { id: searchId, query: searchQuery },
    }));
  }

  async muteItem(itemKey: string): Promise<void> {
    await this.db.update(items).set({ muted: true }).where(eq(items.itemKey, itemKey));
  }

  /** Pour chaque empreinte, l'état des autres annonces (hors `excludeKeys`) : ignorée, déjà signalée. */
  async fingerprintStates(fingerprints: string[], excludeKeys: string[]): Promise<Map<string, { muted: boolean; alerted: boolean }>> {
    if (fingerprints.length === 0) return new Map();
    const rows = await this.db
      .select({
        fingerprint: items.fingerprint,
        muted: sql<boolean>`bool_or(${items.muted})`,
        alerted: sql<boolean>`bool_or(${items.alertedNewAt} is not null)`,
      })
      .from(items)
      .where(
        and(
          inArray(items.fingerprint, fingerprints),
          excludeKeys.length > 0 ? notInArray(items.itemKey, excludeKeys) : undefined,
        ),
      )
      .groupBy(items.fingerprint);
    return new Map(rows.map((row) => [row.fingerprint!, { muted: row.muted, alerted: row.alerted }]));
  }

  // --- suivi d'achat ------------------------------------------------------

  async updateItem(itemKey: string, patch: ItemPatch, at: Date): Promise<Item | undefined> {
    const statusChange = "status" in patch ? { statusChangedAt: at, remindedAt: null } : {};
    const [row] = await this.db
      .update(items)
      .set({ ...patch, ...statusChange })
      .where(eq(items.itemKey, itemKey))
      .returning();
    return row;
  }

  async trackedItems(): Promise<Item[]> {
    return this.db
      .select()
      .from(items)
      .where(isNotNull(items.status))
      .orderBy(sql`${items.endAt} asc nulls last`, desc(items.statusChangedAt));
  }

  /** Enchères suivies qui se terminent dans les `minutes` à venir et pas encore rappelées. */
  async dueReminders(now: Date, minutes: number): Promise<Item[]> {
    return this.db
      .select()
      .from(items)
      .where(
        and(
          inArray(items.status, ["watch", "bid"] satisfies TrackStatus[]),
          eq(items.isAuction, true),
          eq(items.muted, false),
          isNull(items.remindedAt),
          gt(items.endAt, now),
          lte(items.endAt, new Date(now.getTime() + minutes * 60_000)),
        ),
      )
      .orderBy(asc(items.endAt));
  }

  async markReminded(itemKey: string, at: Date, price?: ItemPriceUpdate): Promise<void> {
    await this.db
      .update(items)
      .set({ remindedAt: at, ...price })
      .where(eq(items.itemKey, itemKey));
  }

  // --- vendeurs bloqués ---------------------------------------------------

  async blockSeller(username: string): Promise<void> {
    await this.db.insert(blockedSellers).values({ username: username.toLowerCase() }).onConflictDoNothing();
  }

  async unblockSeller(username: string): Promise<boolean> {
    const rows = await this.db
      .delete(blockedSellers)
      .where(eq(blockedSellers.username, username.toLowerCase()))
      .returning({ username: blockedSellers.username });
    return rows.length > 0;
  }

  async blockedSellers(): Promise<Set<string>> {
    const rows = await this.db.select().from(blockedSellers).orderBy(asc(blockedSellers.username));
    return new Set(rows.map((row) => row.username));
  }

  // --- quota eBay ---------------------------------------------------------

  async countApiCalls(now: Date, calls = 1): Promise<void> {
    await this.db
      .insert(apiUsage)
      .values({ day: utcDay(now), calls })
      .onConflictDoUpdate({ target: apiUsage.day, set: { calls: sql`${apiUsage.calls} + ${calls}` } });
  }

  async apiCallsOn(now: Date): Promise<number> {
    const [row] = await this.db.select().from(apiUsage).where(eq(apiUsage.day, utcDay(now)));
    return row?.calls ?? 0;
  }

  // --- état global --------------------------------------------------------

  async getState(): Promise<AppState> {
    const [row] = await this.db.insert(appState).values({ id: 1 }).onConflictDoNothing().returning();
    if (row) return row;
    const [existing] = await this.db.select().from(appState).where(eq(appState.id, 1));
    return existing!;
  }

  async setState(patch: Partial<Omit<AppState, "id">>): Promise<void> {
    await this.db
      .insert(appState)
      .values({ id: 1, ...patch })
      .onConflictDoUpdate({ target: appState.id, set: patch });
  }
}
