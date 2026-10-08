import { existsSync } from "node:fs";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import { Poller } from "./alerts/poller.js";
import { COMMANDS, setupBot } from "./bot/bot.js";
import { TelegramNotifier } from "./bot/notifier.js";
import { loadConfig } from "./config.js";
import { connectDatabase } from "./db/client.js";
import { Repo } from "./db/repo.js";
import { EbayClient } from "./ebay/client.js";
import { Fx } from "./fx.js";

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const config = loadConfig();

  const { db, close } = await connectDatabase(config.databaseUrl);
  const repo = new Repo(db);

  const bot = new Bot(config.telegramToken);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const poller = new Poller({
    repo,
    source: new EbayClient({
      clientId: config.ebayClientId,
      clientSecret: config.ebayClientSecret,
      deliveryCountry: config.deliveryCountry,
      deliveryZip: config.deliveryZip,
      linkDomain: config.linkDomain,
    }),
    fx: new Fx(),
    notifier: new TelegramNotifier(bot.api, config.telegramChatId, config.homeCurrency),
    config,
  });
  const { settled } = setupBot(bot, { repo, poller, config });
  await bot.api.setMyCommands(COMMANDS);

  const shutdown = async () => {
    console.log("[main] arrêt…");
    poller.stop();
    await bot.stop();
    await settled();
    await close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (config.telegramChatId) {
    await bot.api.sendMessage(config.telegramChatId, "🟢 Alerteur démarré. /list pour tes recherches, /help pour l'aide.");
    void poller.start();
  } else {
    console.log("[main] TELEGRAM_CHAT_ID vide : envoie un message au bot, il te répondra ton chat id.");
  }
  await bot.start({ onStart: (info) => console.log(`[main] @${info.username} en écoute`) });
}

main().catch((error: unknown) => {
  const cause = error instanceof Error && error.cause instanceof Error ? `\n  cause : ${error.cause.message}` : "";
  console.error(`[main] ${error instanceof Error ? error.message : String(error)}${cause}`);
  process.exit(1);
});
