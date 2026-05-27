import type { SourcingItem } from '../types';

export function totalPrice(item: SourcingItem) {
  return Number(item.price ?? 0) + Number(item.shipping_price ?? 0);
}

export function hoursUntil(value: string | null, now: number) {
  if (!value) return null;
  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return null;
  return (end - now) / 36e5;
}

export function timeLeftLabel(value: string | null, now: number) {
  if (!value) return null;
  const diff = new Date(value).getTime() - now;
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return 'terminee';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}

export function auctionUrgency(value: string | null, now: number) {
  if (!value) return '';
  const hoursLeft = (new Date(value).getTime() - now) / 36e5;
  if (hoursLeft <= 0) return 'ended';
  if (hoursLeft <= 6) return 'hot';
  if (hoursLeft <= 24) return 'soon';
  return '';
}

export type SignalContext = {
  now: number;
  maxPrice: number | null;
  sellerCount: number;
  favoriteSeller: boolean;
};

/**
 * Raisons humaines pour lesquelles cette carte mérite d'être regardée.
 * Maximum 2 retournées (les plus fortes), pour ne pas saturer la carte.
 */
export function priorityReasons(item: SourcingItem, ctx: SignalContext): string[] {
  const reasons: { text: string; weight: number }[] = [];
  const hoursLeft = hoursUntil(item.auction_end_at, ctx.now);
  const price = totalPrice(item);

  if (hoursLeft !== null && hoursLeft > 0) {
    if (hoursLeft <= 2) reasons.push({ text: `fin dans ${timeLeftLabel(item.auction_end_at, ctx.now)}`, weight: 100 });
    else if (hoursLeft <= 6) reasons.push({ text: `fin dans ${timeLeftLabel(item.auction_end_at, ctx.now)}`, weight: 80 });
    else if (hoursLeft <= 24) reasons.push({ text: `fin ${timeLeftLabel(item.auction_end_at, ctx.now)}`, weight: 50 });
  }

  if (ctx.maxPrice && ctx.maxPrice > 0) {
    const ratio = price / ctx.maxPrice;
    if (ratio <= 0.4) reasons.push({ text: `prix bas (${Math.round(ratio * 100)}% du max)`, weight: 70 });
    else if (ratio <= 0.6) reasons.push({ text: `sous le max`, weight: 40 });
  }

  if (item.bid_count === 0 && hoursLeft !== null && hoursLeft > 0 && hoursLeft <= 24) {
    reasons.push({ text: '0 enchere', weight: 60 });
  }

  if (ctx.favoriteSeller) {
    reasons.push({ text: 'vendeur favori', weight: 55 });
  }

  if (ctx.sellerCount >= 3) {
    reasons.push({ text: `${ctx.sellerCount} cartes chez ce vendeur`, weight: 45 });
  } else if (ctx.sellerCount === 2) {
    reasons.push({ text: '2 cartes chez ce vendeur', weight: 25 });
  }

  return reasons
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((r) => r.text);
}

/**
 * Drapeaux de risque - signaux à afficher pour que l'utilisateur arbitre.
 */
export function riskFlags(item: SourcingItem, ctx: SignalContext): string[] {
  const flags: string[] = [];
  if (!item.image_url) flags.push('sans image');
  if (!item.seller_username) flags.push('vendeur inconnu');
  else if (item.seller_feedback !== null && item.seller_feedback !== undefined && item.seller_feedback < 50) {
    flags.push(`vendeur ${item.seller_feedback} fb`);
  }
  if (item.match_quality === 'partial') flags.push('match partiel');
  if (item.bid_count !== null && item.bid_count !== undefined && item.bid_count >= 5) {
    flags.push(`${item.bid_count} encheres`);
  }
  const price = totalPrice(item);
  if (ctx.maxPrice && price > ctx.maxPrice * 0.9 && price <= ctx.maxPrice) {
    flags.push('proche du max');
  }
  return flags;
}
