import { describe, expect, it } from "vitest";
import { EbayError } from "../src/ebay/client.js";
import { NOW, makeListing, makePoller, newSearch } from "./helpers.js";

describe("Poller (avec Postgres)", () => {
  it("premier passage silencieux, puis seulement les nouveautés", async () => {
    const { repo, source, notifier, poller } = await makePoller();
    const search = await repo.createSearch(newSearch({ maxPrice: 50 }));
    source.newly = [makeListing("1"), makeListing("2")];

    expect(await poller.checkSearch(search)).toBe(0);
    expect(notifier.digests[0]?.map((a) => a.listing.itemKey)).toEqual(["1", "2"]);

    source.newly = [makeListing("3"), makeListing("1"), makeListing("2")];
    expect(await poller.checkSearch((await repo.getSearch(search.id))!)).toBe(1);
    expect(notifier.alerts.map((a) => [a.kind, a.listing.itemKey])).toEqual([["new", "3"]]);

    expect(await poller.checkSearch((await repo.getSearch(search.id))!)).toBe(0);
    expect((await repo.getItem("3"))?.alertedNewAt).toEqual(NOW);
  });

  it("interroge chaque marketplace avec le prix max converti et compte les appels", async () => {
    const { repo, source, poller } = await makePoller();
    const search = await repo.createSearch(newSearch({ maxPrice: 40, marketplaces: ["EBAY_US", "EBAY_GB"] }));
    await poller.checkSearch(search);

    expect(source.calls.map((c) => [c.marketplace, c.sort])).toEqual([
      ["EBAY_US", "newlyListed"],
      ["EBAY_US", "endingSoonest"],
      ["EBAY_GB", "newlyListed"],
      ["EBAY_GB", "endingSoonest"],
    ]);
    expect(source.calls[0]!.filters).toContain("price:[..42.00]");
    expect(source.calls[2]!.filters).toContain("priceCurrency:GBP");
    expect(source.calls[1]!.filters).toContain("itemEndDate:[..2026-10-08T13:00:00.000Z]");
    expect(await repo.apiCallsOn(NOW)).toBe(4);
  });

  it("une alerte non envoyée est retentée au passage suivant", async () => {
    const { repo, source, notifier, poller } = await makePoller();
    const search = await repo.createSearch(newSearch({ maxPrice: 50, seeded: true }));
    source.newly = [makeListing("x")];

    notifier.failAlerts = true;
    expect(await poller.checkSearch(search)).toBe(0);
    notifier.failAlerts = false;
    expect(await poller.checkSearch(search)).toBe(1);
  });

  it("au-delà du plafond, résume et marque le reste comme vu", async () => {
    const { repo, source, notifier, poller } = await makePoller({ maxAlertsPerSearchCycle: 3 });
    const search = await repo.createSearch(newSearch({ maxPrice: 50, seeded: true }));
    source.newly = ["a", "b", "c", "d", "e"].map((key) => makeListing(key));

    expect(await poller.checkSearch(search)).toBe(3);
    expect(notifier.overflows).toEqual([2]);
    expect(await poller.checkSearch(search)).toBe(0);
  });

  it("ignore les vendeurs bloqués et les cartes ignorées", async () => {
    const { repo, source, notifier, poller } = await makePoller();
    const search = await repo.createSearch(newSearch({ maxPrice: 50, seeded: true }));
    source.newly = [makeListing("a", { seller: "Spammer" }), makeListing("b")];
    await repo.blockSeller("spammer");
    await repo.upsertItems([{ itemKey: "b", searchId: search.id, title: "", url: "", seller: "", lastTotal: null }]);
    await repo.muteItem("b");

    expect(await poller.checkSearch(search)).toBe(0);
    expect(notifier.alerts).toEqual([]);
  });

  it("une erreur eBay est notifiée une seule fois et mémorisée sur la recherche", async () => {
    const { repo, source, notifier, poller } = await makePoller();
    const search = await repo.createSearch(newSearch());
    source.search = async () => {
      throw new EbayError("recherche eBay 500");
    };

    await poller.checkSearch(search);
    await poller.checkSearch((await repo.getSearch(search.id))!);
    expect(notifier.errors).toEqual(["recherche eBay 500"]);
    expect((await repo.getSearch(search.id))?.lastError).toBe("recherche eBay 500");
  });

  it("runCycle saute les recherches en pause", async () => {
    const { repo, source, poller } = await makePoller();
    await repo.createSearch(newSearch({ active: false }));
    const active = await repo.createSearch(newSearch({ query: "luka" }));
    await poller.runCycle();
    expect(source.calls).toHaveLength(1);
    expect((await repo.getSearch(active.id))?.seeded).toBe(true);
    expect((await repo.getState()).lastCycleAt).toEqual(NOW);
  });

  it("compare le prix max au coût rendu France (TVA d'import comprise)", async () => {
    const { repo, source, notifier, poller } = await makePoller();
    // 10 + 2 de port = 12 ; vendeur en Chine → 14,40 rendu
    const search = await repo.createSearch(newSearch({ maxPrice: 14, seeded: true }));
    source.newly = [makeListing("cn"), makeListing("de", { country: "DE" })];
    await poller.checkSearch(search);
    expect(notifier.alerts.map((a) => a.listing.itemKey)).toEqual(["de"]);
  });

  it("une carte remise en ligne par le même vendeur n'est pas re-signalée", async () => {
    const { repo, source, notifier, poller } = await makePoller();
    const search = await repo.createSearch(newSearch({ maxPrice: 50, seeded: true }));
    source.newly = [makeListing("1", { title: "Wemby Prizm Silver" })];
    await poller.checkSearch(search);
    source.newly = [makeListing("2", { title: "Wemby Prizm Silver!" })];
    await poller.checkSearch(search);
    expect(notifier.alerts.map((a) => a.listing.itemKey)).toEqual(["1"]);
  });
});
