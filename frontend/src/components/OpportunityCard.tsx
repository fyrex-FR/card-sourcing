import { Clock, ExternalLink, Eye, Store } from 'lucide-react';
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
  onWatch?: (item: SourcingItem) => void;
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
 *   5. Actions (Suivre / Ignorer / eBay / Vendeur)
 *
 * Pas de score numérique exposé : on traduit le score en raisons humaines.
 */
export function OpportunityCard({ item, ctx, variant = 'full', onWatch, onIgnore, onPlanBid, onOpenSeller }: Props) {
  const reasons = priorityReasons(item, ctx);
  const risks = riskFlags(item, ctx);
  const urgency = auctionUrgency(item.auction_end_at, ctx.now);
  const timeLeft = timeLeftLabel(item.auction_end_at, ctx.now);
  const price = totalPrice(item);
  const planned = item.status === 'bid_planned';

  return (
    <article className={`opp-card ${variant}${planned ? ' planned' : ''}`}>
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
        </div>

        <div className="opp-actions">
          {onPlanBid && (
            <button type="button" className="opp-bid" onClick={() => onPlanBid(item)}>
              {planned && item.max_bid ? `Max ${money(item.max_bid, item.currency)}` : 'Encherir'}
            </button>
          )}
          {onWatch && !planned && (
            <button type="button" onClick={() => onWatch(item)}>
              Suivre
            </button>
          )}
          {onIgnore && (
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
