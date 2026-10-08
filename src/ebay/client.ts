import { z } from "zod";
import { ItemSummarySchema, toListing } from "./listing.js";
import type { Listing } from "./listing.js";
import type { Buying } from "../db/schema.js";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const ITEM_URL = "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id";

export class EbayError extends Error {}
export class EbayRateLimitError extends EbayError {}

export type SearchSort = "newlyListed" | "endingSoonest" | "price";

export interface FilterOptions {
  buying: Buying;
  maxPrice?: number | null;
  currency: string;
  country?: string | null;
  endingBefore?: Date;
}

export interface SearchOptions {
  marketplace: string;
  filters: string[];
  sort: SearchSort;
  limit: number;
}

/** Ce dont le poller a besoin : permet de brancher un faux eBay dans les tests. */
export interface ListingSource {
  buildFilters(options: FilterOptions): string[];
  search(query: string, options: SearchOptions): Promise<Listing[]>;
  /** État actuel d'une annonce ; null si elle n'existe plus. */
  getItem(itemKey: string, marketplace: string): Promise<Listing | null>;
}

const SearchResponseSchema = z.object({ itemSummaries: z.array(z.unknown()).default([]) });

export function formatEbayDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export class EbayClient implements ListingSource {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      deliveryCountry?: string;
      deliveryZip?: string;
      linkDomain?: string;
      fetch?: typeof fetch;
    },
  ) {}

  private get fetch(): typeof fetch {
    return this.options.fetch ?? globalThis.fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const credentials = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64");
    const response = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    if (!response.ok) throw new EbayError(`token eBay refusé (${response.status}): ${(await response.text()).slice(0, 200)}`);
    const data = z.object({ access_token: z.string(), expires_in: z.number().default(7200) }).parse(await response.json());
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  buildFilters({ buying, maxPrice, currency, country, endingBefore }: FilterOptions): string[] {
    const buyingFilter = { ALL: "AUCTION|FIXED_PRICE", AUCTION: "AUCTION", FIXED_PRICE: "FIXED_PRICE" }[buying];
    const filters = [`buyingOptions:{${buyingFilter}}`];
    if (maxPrice != null) filters.push(`price:[..${maxPrice.toFixed(2)}]`, `priceCurrency:${currency}`);
    if (country) filters.push(`itemLocationCountry:${country.toUpperCase()}`);
    if (this.options.deliveryCountry) filters.push(`deliveryCountry:${this.options.deliveryCountry}`);
    if (endingBefore) filters.push(`itemEndDate:[..${formatEbayDate(endingBefore)}]`);
    return filters;
  }

  private async headers(marketplace: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
    };
    const { deliveryCountry, deliveryZip } = this.options;
    if (deliveryCountry) {
      const context = deliveryZip ? `country=${deliveryCountry},zip=${deliveryZip}` : `country=${deliveryCountry}`;
      headers["X-EBAY-C-ENDUSERCTX"] = `contextualLocation=${encodeURIComponent(context)}`;
    }
    return headers;
  }

  async getItem(itemKey: string, marketplace: string): Promise<Listing | null> {
    const params = new URLSearchParams({ legacy_item_id: itemKey });
    const response = await this.fetch(`${ITEM_URL}?${params}`, { headers: await this.headers(marketplace) });
    if (response.status === 429) throw new EbayRateLimitError("quota eBay atteint (429)");
    if (response.status === 401) this.token = null;
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) throw new EbayError(`annonce eBay ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const parsed = ItemSummarySchema.safeParse(await response.json());
    return parsed.success ? toListing(parsed.data, marketplace, this.options.linkDomain) : null;
  }

  async search(query: string, { marketplace, filters, sort, limit }: SearchOptions): Promise<Listing[]> {
    const headers = await this.headers(marketplace);
    const params = new URLSearchParams({ q: query, sort, limit: String(Math.min(Math.max(limit, 1), 200)) });
    if (filters.length > 0) params.set("filter", filters.join(","));

    const response = await this.fetch(`${SEARCH_URL}?${params}`, { headers });
    if (response.status === 429) throw new EbayRateLimitError("quota eBay atteint (429)");
    if (response.status === 401) this.token = null;
    if (!response.ok) throw new EbayError(`recherche eBay ${response.status}: ${(await response.text()).slice(0, 300)}`);

    const { itemSummaries } = SearchResponseSchema.parse(await response.json());
    const listings: Listing[] = [];
    for (const raw of itemSummaries) {
      const parsed = ItemSummarySchema.safeParse(raw);
      const listing = parsed.success ? toListing(parsed.data, marketplace, this.options.linkDomain) : null;
      if (listing) listings.push(listing);
    }
    return listings;
  }
}
