import { z } from "zod";

const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean));

const required = (message: string) => z.string({ error: message }).trim().min(1, message);

const EnvSchema = z.object({
  DATABASE_URL: required("DATABASE_URL manquant (Postgres)"),
  TELEGRAM_BOT_TOKEN: required("TELEGRAM_BOT_TOKEN manquant (crée un bot avec @BotFather)"),
  /** Seul chat autorisé. Vide : le bot répond ton chat id pour t'aider à le configurer. */
  TELEGRAM_CHAT_ID: z.string().trim().default(""),
  EBAY_CLIENT_ID: required("EBAY_CLIENT_ID manquant"),
  EBAY_CLIENT_SECRET: required("EBAY_CLIENT_SECRET manquant"),
  DEFAULT_MARKETPLACES: list("EBAY_US"),
  /** Port calculé pour ce pays ; les annonces non livrables y sont exclues. */
  DELIVERY_COUNTRY: z.string().default("FR").transform((v) => v.toUpperCase()),
  DELIVERY_ZIP: z.string().default("75001"),
  HOME_CURRENCY: z.string().default("EUR").transform((v) => v.toUpperCase()),
  /** Domaine des liens envoyés (vide = lien de la marketplace interrogée). */
  EBAY_LINK_DOMAIN: z.string().default("www.ebay.fr"),
  /** Quota Browse API = 5000 appels/jour : on garde de la marge. */
  EBAY_DAILY_BUDGET: z.coerce.number().int().positive().default(4500),
  MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  /** Au-delà, on résume au lieu d'envoyer une alerte par carte. */
  MAX_ALERTS_PER_SEARCH_CYCLE: z.coerce.number().int().positive().default(10),
});

export interface Config {
  databaseUrl: string;
  telegramToken: string;
  telegramChatId: string;
  ebayClientId: string;
  ebayClientSecret: string;
  defaultMarketplaces: string[];
  deliveryCountry: string;
  deliveryZip: string;
  homeCurrency: string;
  linkDomain: string;
  ebayDailyBudget: number;
  minIntervalSeconds: number;
  maxAlertsPerSearchCycle: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `- ${issue.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${problems}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    telegramToken: e.TELEGRAM_BOT_TOKEN,
    telegramChatId: e.TELEGRAM_CHAT_ID,
    ebayClientId: e.EBAY_CLIENT_ID,
    ebayClientSecret: e.EBAY_CLIENT_SECRET,
    defaultMarketplaces: e.DEFAULT_MARKETPLACES,
    deliveryCountry: e.DELIVERY_COUNTRY,
    deliveryZip: e.DELIVERY_ZIP,
    homeCurrency: e.HOME_CURRENCY,
    linkDomain: e.EBAY_LINK_DOMAIN,
    ebayDailyBudget: e.EBAY_DAILY_BUDGET,
    minIntervalSeconds: e.MIN_INTERVAL_SECONDS,
    maxAlertsPerSearchCycle: e.MAX_ALERTS_PER_SEARCH_CYCLE,
  };
}
