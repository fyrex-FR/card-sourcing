import type { Bot, Context, InlineKeyboard } from "grammy";
import type { Poller } from "../alerts/poller.js";
import type { Config } from "../config.js";
import type { Repo, SearchPatch } from "../db/repo.js";
import { BUYING_OPTIONS } from "../db/schema.js";
import type { Buying, Search } from "../db/schema.js";
import { EbayRateLimitError } from "../ebay/client.js";
import { BUYING_LABEL, escapeHtml, helpText, searchLabel, searchListLine, searchSummary } from "./format.js";
import {
  blockedSellersKeyboard,
  confirmDeleteKeyboard,
  handledAlertKeyboard,
  searchKeyboard,
} from "./keyboards.js";
import { ParseError, parseAdd, parseCountry, parseExcludes, parseMarketplaces, parsePrice, parseWindow } from "./parse.js";

export const COMMANDS = [
  { command: "add", description: "Nouvelle recherche : /add wemby prizm silver max=80" },
  { command: "list", description: "Mes recherches" },
  { command: "status", description: "État du bot et quota eBay" },
  { command: "pause", description: "Mettre toutes les alertes en pause" },
  { command: "resume", description: "Reprendre les alertes" },
  { command: "blocked", description: "Vendeurs bloqués" },
  { command: "help", description: "Aide" },
];

const EDIT_PROMPTS = {
  max: "Envoie le nouveau prix max port inclus (ex : <code>80</code>), ou <code>0</code> pour l'enlever.",
  query: "Envoie les nouveaux mots-clés de recherche.",
  excludes: "Envoie les mots à exclure séparés par des espaces (ex : <code>reprint lot custom</code>), ou <code>-</code> pour vider.",
  window: "Combien de minutes avant la fin veux-tu l'alerte d'enchère ? (ex : <code>30</code>)",
  country: "Code pays du vendeur (ex : <code>CN</code>, <code>JP</code>), ou <code>-</code> pour tous.",
  sites: "Sites eBay séparés par des virgules (ex : <code>US,GB,DE</code>).",
} as const;
type EditableField = keyof typeof EDIT_PROMPTS;

/** Ces champs élargissent ou changent les résultats : on ré-enregistre le stock existant en silence. */
const RESEED_FIELDS: ReadonlySet<EditableField> = new Set(["max", "query", "excludes", "country", "sites"]);

function parseEdit(field: EditableField, text: string): SearchPatch {
  switch (field) {
    case "max":
      return { maxPrice: parsePrice(text) || null };
    case "query":
      if (!text.trim()) throw new ParseError("Mots-clés vides");
      return { query: text.trim() };
    case "excludes":
      return { excludes: parseExcludes(text) };
    case "window":
      return { endingWindowMin: parseWindow(text) };
    case "country":
      return { country: parseCountry(text) };
    case "sites":
      return { marketplaces: parseMarketplaces(text) };
  }
}

export interface BotDeps {
  repo: Repo;
  poller: Poller;
  config: Pick<Config, "telegramChatId" | "homeCurrency" | "defaultMarketplaces" | "ebayDailyBudget">;
}

/** Branche les commandes et boutons sur le bot. */
export function setupBot(bot: Bot, deps: BotDeps) {
  const { repo, poller, config } = deps;
  const background = new Set<Promise<void>>();
  // Un seul utilisateur : la saisie en attente tient dans une variable.
  let pending: { searchId: number; field: EditableField } | null = null;

  const html = (ctx: Context, text: string, keyboard?: InlineKeyboard) =>
    ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard, link_preview_options: { is_disabled: true } });
  const notify = (text: string) => bot.api.sendMessage(config.telegramChatId, text, { parse_mode: "HTML" });

  /** Lance une vérification sans bloquer la réponse du bot. */
  const checkInBackground = (search: Search, reportEmpty = false) => {
    const task = poller
      .checkSearch(search)
      .then(async (sent) => {
        if (reportEmpty && sent === 0) await notify(`🔍 ${escapeHtml(searchLabel(search))} : rien de nouveau.`);
      })
      .catch(async (error: unknown) => {
        console.error(`[bot] vérification #${search.id}:`, error);
        const message = error instanceof EbayRateLimitError ? "⛔ Quota eBay atteint (429), réessaie plus tard." : `⚠️ Vérification impossible : ${escapeHtml(String(error))}`;
        await notify(message).catch(() => undefined);
      })
      .finally(() => background.delete(task));
    background.add(task);
  };

  // --- garde : bot privé ------------------------------------------------------

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id.toString();
    if (!config.telegramChatId) {
      if (ctx.message && chatId) {
        await html(ctx, `Ton chat id est <code>${chatId}</code>.\nMets-le dans TELEGRAM_CHAT_ID puis redémarre le bot.`);
      }
      return;
    }
    if (chatId !== config.telegramChatId) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
    await next();
  });

  bot.on("message:entities:bot_command", async (_ctx, next) => {
    pending = null;
    await next();
  });

  // --- commandes ---------------------------------------------------------------

  bot.command(["start", "help"], (ctx) => html(ctx, helpText(config.homeCurrency, config.defaultMarketplaces)));

  bot.command("add", async (ctx) => {
    if (!ctx.match.trim()) {
      await html(ctx, "Exemple : <code>/add wembanyama prizm silver max=80 type=auction -reprint</code>\n/help pour toutes les options.");
      return;
    }
    let parsed;
    try {
      parsed = parseAdd(ctx.match);
    } catch (error) {
      if (error instanceof ParseError) return void (await html(ctx, `❌ ${escapeHtml(error.message)}`));
      throw error;
    }
    const search = await repo.createSearch({ ...parsed, marketplaces: parsed.marketplaces ?? config.defaultMarketplaces });
    await html(ctx, `✅ Recherche créée\n\n${searchSummary(search, config.homeCurrency)}`, searchKeyboard(search));
    checkInBackground(search);
  });

  bot.command("list", async (ctx) => {
    const searches = await repo.listSearches();
    if (searches.length === 0) return void (await html(ctx, "Aucune recherche. Crée-en une avec /add"));
    const lines = searches.map((search) => searchListLine(search, config.homeCurrency));
    await html(ctx, ["<b>Tes recherches</b> (touche /sN pour gérer)", "", ...lines].join("\n"));
  });

  bot.hears(/^\/s(\d+)(?:@\w+)?$/, async (ctx) => {
    const search = await repo.getSearch(Number(ctx.match[1]));
    if (!search) return void (await html(ctx, "Recherche introuvable. /list"));
    await html(ctx, searchSummary(search, config.homeCurrency), searchKeyboard(search));
  });

  bot.command("status", async (ctx) => {
    const status = await poller.status();
    const state = await repo.getState();
    const minutesAgo = state.lastCycleAt ? Math.floor((poller.now().getTime() - state.lastCycleAt.getTime()) / 60_000) : null;
    const lines = [
      "<b>État</b>",
      state.paused ? "⏸ En pause (/resume)" : "▶️ Actif",
      `Recherches actives : ${status.active.length}`,
      `Appels eBay par passage : ${status.callsPerCycle}`,
      `Vérification toutes les : ${Math.max(1, Math.round(status.intervalSeconds / 60))} min`,
      `Dernier passage : ${minutesAgo === null ? "jamais" : minutesAgo === 0 ? "à l'instant" : `il y a ${minutesAgo} min`}`,
      `Quota eBay aujourd'hui : ${status.callsToday} / ${config.ebayDailyBudget}`,
    ];
    const tooShort = status.active.filter(
      (s) => s.buying !== "FIXED_PRICE" && s.maxPrice !== null && s.endingWindowMin * 60 < status.intervalSeconds,
    );
    if (tooShort.length > 0) {
      lines.push(
        "",
        `⚠️ Fenêtre de fin d'enchère plus courte que l'intervalle pour ${tooShort.map((s) => `/s${s.id}`).join(", ")}. ` +
          "Allonge la fenêtre ou réduis le nombre de recherches.",
      );
    }
    await html(ctx, lines.join("\n"));
  });

  bot.command("pause", async (ctx) => {
    await repo.setState({ paused: true });
    await html(ctx, "⏸ Alertes en pause. /resume pour reprendre.");
  });

  bot.command("resume", async (ctx) => {
    await repo.setState({ paused: false });
    poller.wake();
    await html(ctx, "▶️ Alertes relancées.");
  });

  bot.command("blocked", async (ctx) => {
    const sellers = [...(await repo.blockedSellers())];
    if (sellers.length === 0) return void (await html(ctx, "Aucun vendeur bloqué."));
    await html(ctx, `<b>Vendeurs bloqués</b> (${sellers.length})`, blockedSellersKeyboard(sellers));
  });

  // --- boutons des alertes ----------------------------------------------------

  bot.callbackQuery(/^(mute|block):(.+)$/, async (ctx) => {
    const [, action, itemKey] = ctx.match;
    const item = await repo.getItem(itemKey!);
    if (!item) return void (await ctx.answerCallbackQuery("Annonce inconnue"));
    let label: string;
    if (action === "mute") {
      await repo.muteItem(item.itemKey);
      label = "🙈 Ignorée";
      await ctx.answerCallbackQuery("Plus d'alerte pour cette carte");
    } else {
      if (item.seller) await repo.blockSeller(item.seller);
      label = `🚫 ${item.seller} bloqué`;
      await ctx.answerCallbackQuery("Vendeur bloqué");
    }
    await ctx.editMessageReplyMarkup({ reply_markup: handledAlertKeyboard(item.url, label) }).catch(() => undefined);
  });

  bot.callbackQuery(/^unblock:(.+)$/, async (ctx) => {
    await repo.unblockSeller(ctx.match[1]!);
    await ctx.answerCallbackQuery(`${ctx.match[1]} débloqué`);
  });

  bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

  // --- boutons des recherches -------------------------------------------------

  bot.callbackQuery(/^(edit|type|toggle|del|run):(\d+)(?::(.+))?$/, async (ctx) => {
    const [, action, id, extra] = ctx.match;
    const search = await repo.getSearch(Number(id));
    if (!search) return void (await ctx.answerCallbackQuery("Recherche introuvable"));

    switch (action) {
      case "edit": {
        if (!extra || !(extra in EDIT_PROMPTS)) return void (await ctx.answerCallbackQuery());
        const field = extra as EditableField;
        pending = { searchId: search.id, field };
        await ctx.answerCallbackQuery();
        await html(ctx, `${escapeHtml(searchLabel(search))}\n${EDIT_PROMPTS[field]}`);
        return;
      }
      case "type": {
        if (!BUYING_OPTIONS.includes(extra as Buying)) return void (await ctx.answerCallbackQuery());
        const updated = (await repo.updateSearch(search.id, { buying: extra as Buying, seeded: false }))!;
        await ctx.answerCallbackQuery(`Type : ${BUYING_LABEL[updated.buying]}`);
        await html(ctx, searchSummary(updated, config.homeCurrency), searchKeyboard(updated));
        if (updated.active) checkInBackground(updated);
        return;
      }
      case "toggle": {
        const updated = (await repo.updateSearch(search.id, { active: !search.active }))!;
        await ctx.answerCallbackQuery(updated.active ? "Reprise" : "En pause");
        await ctx.editMessageReplyMarkup({ reply_markup: searchKeyboard(updated) }).catch(() => undefined);
        poller.wake();
        return;
      }
      case "del": {
        if (extra === "ok") {
          await repo.deleteSearch(search.id);
          await ctx.answerCallbackQuery("Supprimée");
          await html(ctx, `🗑 ${escapeHtml(searchLabel(search))} supprimée.`);
        } else {
          await ctx.answerCallbackQuery();
          await html(ctx, `Supprimer <b>${escapeHtml(searchLabel(search))}</b> ?`, confirmDeleteKeyboard(search.id));
        }
        return;
      }
      case "run": {
        await ctx.answerCallbackQuery("Vérification en cours…");
        checkInBackground(search, true);
        return;
      }
    }
  });

  // --- saisie libre (réponse à un bouton "modifier") ---------------------------

  bot.on("message:text", async (ctx) => {
    if (!pending) {
      await html(ctx, "Tape /help pour voir les commandes, ou /add suivi de ta recherche.");
      return;
    }
    const { searchId, field } = pending;
    let patch: SearchPatch;
    try {
      patch = parseEdit(field, ctx.message.text);
    } catch (error) {
      if (error instanceof ParseError) return void (await html(ctx, `❌ ${escapeHtml(error.message)} — réessaie, ou /list pour annuler.`));
      throw error;
    }
    pending = null;
    if (RESEED_FIELDS.has(field)) patch.seeded = false;
    const updated = await repo.updateSearch(searchId, { ...patch, lastError: null });
    if (!updated) return void (await html(ctx, "Recherche introuvable."));
    await html(ctx, `✅ Modifié\n\n${searchSummary(updated, config.homeCurrency)}`, searchKeyboard(updated));
    if (updated.active) checkInBackground(updated);
  });

  bot.catch(async ({ ctx, error }) => {
    console.error("[bot]", error);
    await ctx.reply(`⚠️ Erreur : ${escapeHtml(String(error)).slice(0, 300)}`).catch(() => undefined);
  });

  return {
    /** Attend la fin des vérifications lancées en tâche de fond (tests, arrêt propre). */
    settled: async () => {
      while (background.size > 0) await Promise.allSettled([...background]);
    },
  };
}
