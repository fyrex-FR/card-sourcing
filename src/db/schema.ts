import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const BUYING_OPTIONS = ["ALL", "AUCTION", "FIXED_PRICE"] as const;
export type Buying = (typeof BUYING_OPTIONS)[number];
export type AlertKind = "new" | "under" | "ending";

export const GRADING_OPTIONS = ["ANY", "GRADED", "RAW"] as const;
export type Grading = (typeof GRADING_OPTIONS)[number];

/** Suivi d'achat : à suivre, à enchérir (avec plafond), achetée. */
export const TRACK_STATUSES = ["watch", "bid", "bought"] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export const searches = pgTable("searches", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  /** Prix max port inclus, en devise locale (HOME_CURRENCY). */
  maxPrice: doublePrecision("max_price"),
  buying: text("buying").$type<Buying>().notNull().default("ALL"),
  /** Pays où se trouve le vendeur (code ISO 2 lettres). */
  country: text("country"),
  excludes: text("excludes").array().notNull().default(sql`'{}'::text[]`),
  /** Le titre doit contenir chacun de ces mots. */
  requiredWords: text("required_words").array().notNull().default(sql`'{}'::text[]`),
  grading: text("grading").$type<Grading>().notNull().default("ANY"),
  excludeLots: boolean("exclude_lots").notNull().default(false),
  minSellerFeedbackPct: doublePrecision("min_seller_feedback_pct"),
  minSellerFeedbackScore: integer("min_seller_feedback_score"),
  endingWindowMin: integer("ending_window_min").notNull().default(60),
  marketplaces: text("marketplaces").array().notNull().default(sql`'{EBAY_US}'::text[]`),
  active: boolean("active").notNull().default(true),
  /** Faux tant que le stock existant n'a pas été enregistré (premier passage silencieux). */
  seeded: boolean("seeded").notNull().default(false),
  /** Idem pour la partie Vinted, suivie séparément de la partie eBay. */
  vintedSeeded: boolean("vinted_seeded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Annonces déjà vues, partagées entre recherches pour ne jamais alerter deux fois. */
export const items = pgTable(
  "items",
  {
    itemKey: text("item_key").primaryKey(),
    searchId: integer("search_id").references(() => searches.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    seller: text("seller").notNull().default(""),
    /** Vendeur + titre normalisé : reconnaît une même carte remise en ligne. */
    fingerprint: text("fingerprint"),
    country: text("country").notNull().default(""),
    marketplace: text("marketplace").notNull().default("EBAY_US"),
    imageUrl: text("image_url").notNull().default(""),
    isAuction: boolean("is_auction").notNull().default(false),
    endAt: timestamp("end_at", { withTimezone: true }),
    /** Prix et port dans la devise de l'annonce. */
    price: doublePrecision("price"),
    shipping: doublePrecision("shipping"),
    currency: text("currency"),
    bidCount: integer("bid_count"),
    /** Dernier coût rendu France vu (port, TVA et frais d'import inclus), en devise locale. */
    lastTotal: doublePrecision("last_total"),
    /** Dont TVA et frais d'import, en devise locale. */
    importCost: doublePrecision("import_cost"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    alertedNewAt: timestamp("alerted_new_at", { withTimezone: true }),
    alertedEndingAt: timestamp("alerted_ending_at", { withTimezone: true }),
    /** Dernière alerte émise (envoyée sur Telegram ou résumée), pour l'historique web. */
    lastAlertKind: text("last_alert_kind").$type<AlertKind>(),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    muted: boolean("muted").notNull().default(false),
    status: text("status").$type<TrackStatus>(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    /** Plafond en coût rendu, devise locale. */
    maxBid: doublePrecision("max_bid"),
    note: text("note"),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
  },
  (table) => [index("items_fingerprint_idx").on(table.fingerprint), index("items_status_idx").on(table.status)],
);

export const blockedSellers = pgTable("blocked_sellers", {
  username: text("username").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Appels Browse API par jour UTC (quota eBay). */
export const apiUsage = pgTable("api_usage", {
  day: text("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
});

/** Ligne unique d'état global. */
export const appState = pgTable(
  "app_state",
  {
    id: integer("id").primaryKey().default(1),
    paused: boolean("paused").notNull().default(false),
    lastCycleAt: timestamp("last_cycle_at", { withTimezone: true }),
    budgetWarnedDay: text("budget_warned_day"),
    /** TVA à l'import pour un vendeur hors UE (0 pour l'ignorer). */
    importVatRate: doublePrecision("import_vat_rate").notNull().default(0.2),
    /** Frais du transporteur pour dédouaner un colis de plus de 150 €. */
    customsFee: doublePrecision("customs_fee").notNull().default(0),
    /** Rappel Telegram avant la fin des enchères suivies. */
    reminderMinutes: integer("reminder_minutes").notNull().default(10),
  },
  (table) => [check("app_state_singleton", sql`${table.id} = 1`)],
);

export type Search = typeof searches.$inferSelect;
export type NewSearch = typeof searches.$inferInsert;
export type Item = typeof items.$inferSelect;
export type AppState = typeof appState.$inferSelect;
export type ImportSettings = Pick<AppState, "importVatRate" | "customsFee">;
