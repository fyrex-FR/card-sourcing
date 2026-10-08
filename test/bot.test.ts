import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";
import { setupBot } from "../src/bot/bot.js";
import { makeListing, makePoller, newSearch } from "./helpers.js";

const CHAT = 42;

async function makeBot(chatId = String(CHAT)) {
  const deps = await makePoller();
  const bot = new Bot("123:test", { botInfo: { id: 1, is_bot: true, first_name: "Alerteur", username: "alerteur_bot" } as UserFromGetMe });
  const sent: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" ? { message_id: sent.length, date: 0, chat: { id: CHAT, type: "private" }, text: "" } : true;
    return { ok: true, result } as never;
  });
  const { settled } = setupBot(bot, {
    repo: deps.repo,
    poller: deps.poller,
    config: { telegramChatId: chatId, homeCurrency: "EUR", defaultMarketplaces: ["EBAY_US"], ebayDailyBudget: 4500 },
    createLoginLink: () => ({ url: "https://alertes.test/auth/callback?token=abc", code: "123456" }),
  });
  let updateId = 0;
  const send = async (text: string, chat = CHAT) => {
    const command = /^\/\w+/.exec(text)?.[0];
    const update: Update = {
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: chat, type: "private", first_name: "X" },
        from: { id: chat, is_bot: false, first_name: "X" },
        text,
        ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command.length }] } : {}),
      },
    };
    await bot.handleUpdate(update);
    await settled();
  };
  const press = async (data: string) => {
    await bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: String(updateId),
        chat_instance: "c",
        data,
        from: { id: CHAT, is_bot: false, first_name: "X" },
        message: { message_id: 7, date: 0, chat: { id: CHAT, type: "private", first_name: "X" }, text: "" },
      },
    });
    await settled();
  };
  const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => String(s.payload.text));
  return { ...deps, bot, sent, send, press, texts };
}

describe("bot Telegram", () => {
  it("ignore les inconnus", async () => {
    const { repo, send, sent } = await makeBot();
    await send("/add wemby", 999);
    expect(await repo.listSearches()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("donne le chat id tant qu'il n'est pas configuré", async () => {
    const { send, texts } = await makeBot("");
    await send("/start", 12345);
    expect(texts()[0]).toContain("12345");
  });

  it("/add crée la recherche puis fait le premier passage", async () => {
    const { repo, source, send, texts } = await makeBot();
    source.newly = [makeListing("1")];
    await send("/add wemby prizm max=40 -reprint");

    const [search] = await repo.listSearches();
    expect(search).toMatchObject({ query: "wemby prizm", maxPrice: 40, excludes: ["reprint"], seeded: true });
    expect(texts()[0]).toContain("Recherche créée");
  });

  it("/add avec une option invalide explique l'erreur", async () => {
    const { repo, send, texts } = await makeBot();
    await send("/add wemby type=foo");
    expect(await repo.listSearches()).toEqual([]);
    expect(texts()[0]).toContain("type= attend");
  });

  it("modifie le prix max via le bouton puis une réponse libre", async () => {
    const { repo, send, press } = await makeBot();
    const search = await repo.createSearch(newSearch({ maxPrice: 40, seeded: true }));
    await press(`edit:${search.id}:max`);
    await send("65,5");
    expect(await repo.getSearch(search.id)).toMatchObject({ maxPrice: 65.5, seeded: true });
  });

  it("une commande annule la saisie en attente", async () => {
    const { repo, send, press } = await makeBot();
    const search = await repo.createSearch(newSearch({ maxPrice: 40 }));
    await press(`edit:${search.id}:max`);
    await send("/list");
    await send("99");
    expect((await repo.getSearch(search.id))?.maxPrice).toBe(40);
  });

  it("suivre, ignorer une carte et bloquer un vendeur depuis l'alerte", async () => {
    const { repo, press } = await makeBot();
    const search = await repo.createSearch(newSearch());
    await repo.upsertItems([
      { itemKey: "a", searchId: search.id, title: "t", url: "https://www.ebay.fr/itm/a", seller: "Bob", lastTotal: 10 },
    ]);
    await press("watch:a");
    expect((await repo.getItem("a"))?.status).toBe("watch");
    await press("mute:a");
    await press("block:a");
    expect((await repo.getItem("a"))?.muted).toBe(true);
    expect(await repo.blockedSellers()).toEqual(new Set(["bob"]));
  });

  it("pause, liste et suppression", async () => {
    const { repo, send, press, texts } = await makeBot();
    const search = await repo.createSearch(newSearch({ query: "luka" }));
    await press(`toggle:${search.id}`);
    await send("/list");
    expect(texts().at(-1)).toContain(`⏸ /s${search.id} luka`);
    await press(`del:${search.id}:ok`);
    expect(await repo.listSearches()).toEqual([]);
  });
});
