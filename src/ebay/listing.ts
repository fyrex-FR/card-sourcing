import { z } from "zod";
import { marketplaceCurrency } from "./marketplaces.js";

const Amount = z.object({ value: z.coerce.number(), currency: z.string().optional() });

/** Sous-ensemble utile d'un itemSummary de la Browse API. */
export const ItemSummarySchema = z.object({
  itemId: z.string(),
  legacyItemId: z.string().optional(),
  title: z.string().default(""),
  itemWebUrl: z.string().default(""),
  buyingOptions: z.array(z.string()).default([]),
  price: Amount.optional(),
  currentBidPrice: Amount.optional(),
  bidCount: z.number().int().optional(),
  itemEndDate: z.string().optional(),
  itemCreationDate: z.string().optional(),
  condition: z.string().optional(),
  image: z.object({ imageUrl: z.string() }).optional(),
  thumbnailImages: z.array(z.object({ imageUrl: z.string() })).optional(),
  shippingOptions: z.array(z.object({ shippingCost: Amount.optional() })).optional(),
  seller: z
    .object({
      username: z.string().optional(),
      feedbackPercentage: z.string().optional(),
      feedbackScore: z.number().optional(),
    })
    .optional(),
  itemLocation: z.object({ country: z.string().optional() }).optional(),
});

export type ItemSummary = z.infer<typeof ItemSummarySchema>;

export interface Listing {
  /** ID legacy eBay, identique sur toutes les marketplaces. */
  itemKey: string;
  title: string;
  url: string;
  imageUrl: string;
  /** Enchère en cours pour une enchère, prix fixe sinon. */
  price: number;
  currency: string;
  shipping: number | null;
  /** Prix "achat immédiat" quand une enchère en propose un. */
  binPrice: number | null;
  buyingOptions: string[];
  marketplace: string;
  endAt: Date | null;
  createdAt: Date | null;
  bidCount: number | null;
  seller: string;
  sellerFeedbackPct: string | null;
  sellerFeedbackScore: number | null;
  country: string;
  condition: string;
}

export const isAuction = (listing: Listing) => listing.buyingOptions.includes("AUCTION");
export const totalPrice = (listing: Listing) => listing.price + (listing.shipping ?? 0);

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function itemKeyOf(item: Pick<ItemSummary, "itemId" | "legacyItemId">): string {
  if (item.legacyItemId) return item.legacyItemId;
  const parts = item.itemId.split("|");
  return parts[1] ?? item.itemId;
}

export function toListing(item: ItemSummary, marketplace: string, linkDomain = ""): Listing | null {
  const options = item.buyingOptions;
  const auctionBid = options.includes("AUCTION") ? item.currentBidPrice : undefined;
  const main = auctionBid ?? item.price ?? item.currentBidPrice;
  if (!main || !Number.isFinite(main.value)) return null;

  const shippingCosts = (item.shippingOptions ?? [])
    .map((option) => option.shippingCost?.value)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));

  const itemKey = itemKeyOf(item);
  return {
    itemKey,
    title: item.title,
    url: linkDomain && /^\d+$/.test(itemKey) ? `https://${linkDomain}/itm/${itemKey}` : item.itemWebUrl,
    imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? "",
    price: main.value,
    currency: main.currency ?? marketplaceCurrency(marketplace),
    shipping: shippingCosts.length > 0 ? Math.min(...shippingCosts) : null,
    binPrice: auctionBid && options.includes("FIXED_PRICE") && item.price ? item.price.value : null,
    buyingOptions: options,
    marketplace,
    endAt: parseDate(item.itemEndDate),
    createdAt: parseDate(item.itemCreationDate),
    bidCount: item.bidCount ?? null,
    seller: item.seller?.username ?? "",
    sellerFeedbackPct: item.seller?.feedbackPercentage ?? null,
    sellerFeedbackScore: item.seller?.feedbackScore ?? null,
    country: item.itemLocation?.country ?? "",
    condition: item.condition ?? "",
  };
}
