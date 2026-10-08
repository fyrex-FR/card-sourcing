import { describe, expect, it } from "vitest";
import { Reminders } from "../src/alerts/reminders.js";
import { NOW, makeListing, makePoller, newSearch, parityFx } from "./helpers.js";

async function setup() {
  const deps = await makePoller();
  const reminders = new Reminders({ ...deps, fx: parityFx, config: { homeCurrency: "EUR" }, clock: () => NOW });
  const search = await deps.repo.createSearch(newSearch());
  const track = async (itemKey: string, endInMin: number, extra: { status?: "watch" | "bid" | "bought"; maxBid?: number } = {}) => {
    await deps.repo.upsertItems([
      {
        itemKey,
        searchId: search.id,
        title: `Carte ${itemKey}`,
        url: `https://www.ebay.fr/itm/${itemKey}`,
        seller: "bob",
        country: "CN",
        isAuction: true,
        endAt: new Date(NOW.getTime() + endInMin * 60_000),
        price: 10,
        shipping: 5,
        currency: "USD",
        lastTotal: 18,
      },
    ]);
    await deps.repo.updateItem(itemKey, { status: extra.status ?? "bid", maxBid: extra.maxBid ?? null }, NOW);
  };
  return { ...deps, reminders, track };
}

describe("rappels de fin d'enchère", () => {
  it("rappelle une fois les enchères suivies proches de la fin, avec le prix relu sur eBay", async () => {
    const { reminders, track, source, notifier, repo } = await setup();
    await track("soon", 8, { maxBid: 36 });
    await track("later", 45);
    await track("bought", 5, { status: "bought" });
    source.items.set("soon", makeListing("soon", { price: 22, shipping: 5, endInMin: 8, bidCount: 4 }));

    expect(await reminders.tick()).toBe(1);
    const [reminder] = notifier.reminders;
    expect(reminder).toMatchObject({ price: 22, bidCount: 4, gone: false });
    expect(reminder!.landed).toBeCloseTo(27 * 1.2);
    // plafond 36 € rendu → (36 / 1,2) − 5 de port = 25
    expect(reminder!.maxBidListing).toBeCloseTo(25);
    expect((await repo.getItem("soon"))?.price).toBe(22);

    expect(await reminders.tick()).toBe(0);
    expect(await repo.apiCallsOn(NOW)).toBe(1);
  });

  it("signale une annonce disparue", async () => {
    const { reminders, track, notifier } = await setup();
    await track("gone", 5);
    await reminders.tick();
    expect(notifier.reminders[0]?.gone).toBe(true);
  });

  it("un nouveau statut réarme le rappel", async () => {
    const { reminders, track, repo, notifier } = await setup();
    await track("x", 5);
    await reminders.tick();
    await repo.updateItem("x", { status: "watch" }, NOW);
    await reminders.tick();
    expect(notifier.reminders).toHaveLength(2);
  });
});
