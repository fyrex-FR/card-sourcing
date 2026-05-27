import { Clock, ExternalLink, Eye, Store, ShoppingBasket } from 'lucide-react';
import type { SourcingItem } from '../types';
import {
  auctionUrgency,
  priorityReasons,
  riskFlags,
  timeLeftLabel,
  totalPrice,
  type SignalContext,
} from '../lib/itemSignals';

function money(value: number | null, currency = 'USD') {
  if (value === null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}

type Props = {
  item: SourcingItem;
  ctx: SignalContext;
  variant?: 'compact' | 'full';
  onAddToBasket?: (item: SourcingItem) => void;
  onIgnore?: (item: SourcingItem) => void;
  onPlanBid?: (item: SourcingItem) => void;
  onOpenSeller?: (seller: string) => void;
};

/**
 * Carte d'opportunité unique. Hierarchie stricte :
 *   1. Prix total + countdown
 *   2. Titre (1-2 lignes)
 *   3. Raisons de priorité (vert)
 *   4. Risques (orange)
 *   5. Actions
 *
 * Action principale : "Au panier" (status=in_basket). Le but est de constituer
 * un panier vendeur pour optimiser les frais de port en groupant les achats.
 *
 * "Encherir" met le statut à bid_planned + max_bid. Pour les enchères que tu vas
 * disputer activement.
 */
export function OpportunityCard({ item, ctx, variant = 'full', onAddToBasket, onIgnore, onPlanBid, onOpenSeller }: Props) {
  const reasons = priorityReasons(item, ctx);
  const risks = riskFlags(item, ctx);
  const urgency = auctionUrgency(item.auction_end_at, ctx.now);
  const timeLeft = timeLeftLabel(item.auction_end_at, ctx.now);
  const price = totalPrice(item);
  const inBasket = item.status === 'in_basket' || item.status === 'bid_planned';
  const planned = item.status === 'bid_planned';

  return (
    <article className={`opp-card ${variant}${inBasket ? ' in-basket' : ''}${planned ? ' planned' : ''}`}>
      {variant === 'full' && (
        <div className="opp-thumb">
          {item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : <Eye size={24} />}
        </div>
      )}

      <div className="opp-body">
        <div className="opp-headline">
          <strong className="opp-price">{money(price, item.currency)}</strong>
          {timeLeft && (
            <span className={`countdown ${urgency}`}>
              <Clock size={13} /> {timeLeft}
            </span>
          )}
        </div>

        <p className="opp-title">{item.title}</p>

        {reasons.length > 0 && (
          <ul className="opp-reasons" aria-label="Raisons de priorite">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}

        {risks.length > 0 && (
          <ul className="opp-risks" aria-label="Risques">
            {risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        )}

        <div className="opp-meta">
          {item.seller_username ? (
            <button type="button" className="opp-seller" onClick={() => onOpenSeller?.(item.seller_username!)}>
              <Store size={13} /> {item.seller_username}
              {item.seller_feedback !== null && item.seller_feedback !== undefined ? (
                <span className="opp-fb">· {item.seller_feedback}</span>
              ) : null}
            </button>
          ) : (
            <span className="opp-seller muted">vendeur inconnu</span>
          )}
          {item.country && <span className="opp-country">{item.country}</span>}
          {planned && item.max_bid && (
            <span className="max-bid">max {money(item.max_bid, item.currency)}</span>
          )}
        </div>

        <div className="opp-actions">
          {onAddToBasket && (
            <button
              type="button"
              className={inBasket ? 'opp-basket selected' : 'opp-basket'}
              onClick={() => onAddToBasket(item)}
            >
              <ShoppingBasket size={14} /> {inBasket ? 'Retirer' : 'Au panier'}
            </button>
          )}
          {onPlanBid && (
            <button type="button" className="opp-bid" onClick={() => onPlanBid(item)}>
              {planned ? 'Modifier max' : 'Encherir'}
            </button>
          )}
          {onIgnore && !inBasket && (
            <button type="button" className="ghost" onClick={() => onIgnore(item)}>
              Ignorer
            </button>
          )}
          <a href={item.url} target="_blank" rel="noreferrer" className="opp-ebay">
            eBay <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </article>
  );
}
