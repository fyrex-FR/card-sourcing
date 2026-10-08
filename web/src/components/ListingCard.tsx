import type { ReactNode } from "react";
import { flag, money, timeLeft } from "../format";

export interface ListingCardProps {
  title: string;
  url: string;
  imageUrl: string;
  price: string;
  priceDetail?: string;
  badge?: ReactNode;
  meta: (string | null | false | undefined)[];
  endAt?: string | null;
  dimmed?: boolean;
  actions?: ReactNode;
}

export function ListingCard({ title, url, imageUrl, price, priceDetail, badge, meta, endAt, dimmed, actions }: ListingCardProps) {
  const left = timeLeft(endAt);
  return (
    <article className={`listing ${dimmed ? "dimmed" : ""}`}>
      <a className="listing-image" href={url} target="_blank" rel="noreferrer" tabIndex={-1}>
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">🃏</span>}
      </a>
      <div className="listing-body">
        {badge}
        <a className="listing-title" href={url} target="_blank" rel="noreferrer">
          {title}
        </a>
        <div className="listing-price">
          <strong>{price}</strong>
          {priceDetail && <span>{priceDetail}</span>}
        </div>
        <div className="listing-meta">
          {left && <span className={left.includes("min") ? "urgent" : ""}>⏱ fin dans {left}</span>}
          {meta.filter(Boolean).map((item) => (
            <span key={String(item)}>{item}</span>
          ))}
        </div>
        {actions && <div className="listing-actions">{actions}</div>}
      </div>
    </article>
  );
}

export function priceParts(
  listing: { price: number; shipping: number | null; currency: string },
  totalHome: number | null,
  importCost: number | null,
  home: string,
) {
  const shipping = listing.shipping === null ? "port inconnu" : `port ${money(listing.shipping, listing.currency)}`;
  const parts = [money(listing.price, listing.currency), shipping, importCost ? `TVA/import ${money(importCost, home)}` : null];
  return {
    price: money(totalHome ?? listing.price + (listing.shipping ?? 0), totalHome === null ? listing.currency : home),
    priceDetail: `${importCost ? "rendu France · " : ""}${parts.filter(Boolean).join(" + ")}`,
  };
}

export const sellerMeta = (seller: string, country?: string) => (seller ? `👤 ${seller}${country ? ` ${flag(country)}` : ""}` : null);
