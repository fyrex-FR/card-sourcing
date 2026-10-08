import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const BUYING_OPTIONS = ["ALL", "AUCTION", "FIXED_PRICE"] as const;
export type Buying = (typeof BUYING_OPTIONS)[number];

export const searches = pgTable("searches", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  /** Prix max port inclus, en devise locale (HOME_CURRENCY). */
  maxPrice: doublePrecision("max_price"),
  buying: text("buying").$type<Buying>().notNull().default("ALL"),
  /** Pays où se trouve le vendeur (code ISO 2 lettres). */
  country: text("country"),
  excludes: text("excludes").array().notNull().default(sql`'{}'::text[]`),
  endingWindowMin: integer("ending_window_min").notNull().default(60),
  marketplaces: text("marketplaces").array().notNull().default(sql`'{EBAY_US}'::text[]`),
  active: boolean("active").notNull().default(true),
  /** Faux tant que le stock existant n'a pas été enregistré (premier passage silencieux). */
  seeded: boolean("seeded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Annonces déjà vues, partagées entre recherches pour ne jamais alerter deux fois. */
export const items = pgTable("items", {
  itemKey: text("item_key").primaryKey(),
  searchId: integer("search_id").references(() => searches.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  seller: text("seller").notNull().default(""),
  lastTotal: doublePrecision("last_total"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  alertedNewAt: timestamp("alerted_new_at", { withTimezone: true }),
  alertedEndingAt: timestamp("alerted_ending_at", { withTimezone: true }),
  muted: boolean("muted").notNull().default(false),
});

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
  },
  (table) => [check("app_state_singleton", sql`${table.id} = 1`)],
);

export type Search = typeof searches.$inferSelect;
export type NewSearch = typeof searches.$inferInsert;
export type Item = typeof items.$inferSelect;
export type AppState = typeof appState.$inferSelect;
