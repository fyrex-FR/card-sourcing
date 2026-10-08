import { describe, expect, it } from "vitest";
import { EbayClient, EbayRateLimitError } from "../src/ebay/client.js";
import { ItemSummarySchema, toListing, totalPrice } from "../src/ebay/listing.js";

const auctionItem = {
  itemId: "v1|123456|0",
  legacyItemId: "123456",
  title: "Wembanyama Prizm Silver",
  itemWebUrl: "https://www.ebay.com/itm/123456",
  buyingOptions: ["AUCTION", "FIXED_PRICE"],
  price: { value: "50.00", currency: "USD" },
  currentBidPrice: { value: "7.50", currency: "USD" },
  bidCount: 3,
  shippingOptions: [{ shippingCost: { value: "9.00", currency: "USD" } }, { shippingCost: { value: "4.00", currency: "USD" } }],
  itemEndDate: "2026-10-08T13:00:00.000Z",
  seller: { username: "bob", feedbackPercentage: "99.5", feedbackScore: 120 },
  itemLocation: { country: "CN" },
};

describe("toListing", () => {
  it("prend l'enchère en cours, le port le moins cher et le prix achat immédiat", () => {
    const listing = toListing(ItemSummarySchema.parse(auctionItem), "EBAY_US", "www.ebay.fr")!;
    expect(listing).toMatchObject({ itemKey: "123456", price: 7.5, binPrice: 50, shipping: 4, url: "https://www.ebay.fr/itm/123456" });
    expect(totalPrice(listing)).toBe(11.5);
    expect(listing.endAt?.toISOString()).toBe("2026-10-08T13:00:00.000Z");
  });

  it("déduit l'ID legacy de itemId et garde le lien d'origine sans domaine", () => {
    const { legacyItemId: _, ...item } = auctionItem;
    const listing = toListing(ItemSummarySchema.parse({ ...item, buyingOptions: ["FIXED_PRICE"] }), "EBAY_US")!;
    expect(listing).toMatchObject({ itemKey: "123456", price: 50, binPrice: null, url: "https://www.ebay.com/itm/123456" });
  });
});

describe("EbayClient", () => {
  function fakeFetch(searchResponse: Response) {
    const requests: Request[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith("/token")) return Response.json({ access_token: "tok", expires_in: 7200 });
      return searchResponse;
    }) as typeof fetch;
    return { impl, requests };
  }

  it("envoie filtres, marketplace et lieu de livraison, et ignore les annonces illisibles", async () => {
    const { impl, requests } = fakeFetch(Response.json({ itemSummaries: [auctionItem, { nope: true }] }));
    const client = new EbayClient({ clientId: "id", clientSecret: "secret", deliveryCountry: "FR", deliveryZip: "75001", fetch: impl });
    const filters = client.buildFilters({ buying: "AUCTION", maxPrice: 42, currency: "USD", country: "cn" });

    const listings = await client.search("wemby", { marketplace: "EBAY_GB", filters, sort: "newlyListed", limit: 500 });

    expect(listings).toHaveLength(1);
    const search = requests[1]!;
    const url = new URL(search.url);
    expect(url.searchParams.get("filter")).toBe(
      "buyingOptions:{AUCTION},price:[..42.00],priceCurrency:USD,itemLocationCountry:CN,deliveryCountry:FR",
    );
    expect(url.searchParams.get("limit")).toBe("200");
    expect(search.headers.get("X-EBAY-C-MARKETPLACE-ID")).toBe("EBAY_GB");
    expect(search.headers.get("X-EBAY-C-ENDUSERCTX")).toBe("contextualLocation=country%3DFR%2Czip%3D75001");
    expect(search.headers.get("Authorization")).toBe("Bearer tok");
  });

  it("signale le quota atteint", async () => {
    const { impl } = fakeFetch(new Response("too many", { status: 429 }));
    const client = new EbayClient({ clientId: "id", clientSecret: "secret", fetch: impl });
    await expect(client.search("x", { marketplace: "EBAY_US", filters: [], sort: "price", limit: 10 })).rejects.toBeInstanceOf(EbayRateLimitError);
  });
});
