import { useState } from 'react';
import { Bell, Clock, ExternalLink, Eye, Store, ShoppingBasket, TrendingUp } from 'lucide-react';
import type { SourcingItem } from '../types';
import {
  auctionUrgency,
  priorityReasons,
  riskFlags,
  timeLeftLabel,
  totalPrice,
  type SignalContext,
} from '../lib/itemSignals';
import { buildSearchQueries, ebaySoldUrl, extractKeywords, openPoint130 } from '../lib/cardKeywords';

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
  onPlanBid?: (item: SourcingItem, maxBid: number | null) => void;
  onOpenSeller?: (seller: string) => void;
  onUpdateNotify?: (
    item: SourcingItem,
    patch: {
      notify_enabled?: boolean | null;
      notify_minutes_before?: number | null;
      notify_minutes_before_secondary?: number | null;
    },
  ) => void;
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
export function OpportunityCard({
  item,
  ctx,
  variant = 'full',
  onAddToBasket,
  onIgnore,
  onPlanBid,
  onOpenSeller,
  onUpdateNotify,
}: Props) {
  const reasons = priorityReasons(item, ctx);
  const risks = riskFlags(item, ctx);
  const urgency = auctionUrgency(item.auction_end_at, ctx.now);
  const timeLeft = timeLeftLabel(item.auction_end_at, ctx.now);
  const price = totalPrice(item);
  const inBasket = item.status === 'in_basket' || item.status === 'bid_planned';
  const planned = item.status === 'bid_planned';
  const keywords = extractKeywords(item.title);
  const queries = buildSearchQueries(keywords);
  const compsLabel = keywords.player ?? queries.broad;

  const [bidEditOpen, setBidEditOpen] = useState(false);
  const [bidValue, setBidValue] = useState(
    item.max_bid !== null && item.max_bid !== undefined ? String(item.max_bid) : '',
  );

  const [notifyEditOpen, setNotifyEditOpen] = useState(false);
  const [notifyEnabledLocal, setNotifyEnabledLocal] = useState<'default' | 'on' | 'off'>(
    item.notify_enabled === null || item.notify_enabled === undefined
      ? 'default'
      : item.notify_enabled
        ? 'on'
        : 'off',
  );
  const [notifyPrimaryLocal, setNotifyPrimaryLocal] = useState<string>(
    item.notify_minutes_before !== null && item.notify_minutes_before !== undefined
      ? String(item.notify_minutes_before)
      : '',
  );
  const [notifySecondaryLocal, setNotifySecondaryLocal] = useState<string>(
    item.notify_minutes_before_secondary !== null && item.notify_minutes_before_secondary !== undefined
      ? String(item.notify_minutes_before_secondary)
      : '',
  );

  const hasNotifyOverride =
    item.notify_enabled !== null
    || (item.notify_minutes_before !== null && item.notify_minutes_before !== undefined)
    || (item.notify_minutes_before_secondary !== null && item.notify_minutes_before_secondary !== undefined);
  const notifyExplicitlyOff = item.notify_enabled === false;

  function handleBidSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!onPlanBid) return;
    const trimmed = bidValue.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return;
    onPlanBid(item, parsed);
    setBidEditOpen(false);
  }

  function openBidEditor() {
    setBidValue(item.max_bid !== null && item.max_bid !== undefined ? String(item.max_bid) : '');
    setBidEditOpen(true);
  }

  function handleNotifySubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!onUpdateNotify) return;
    const enabled =
      notifyEnabledLocal === 'on' ? true : notifyEnabledLocal === 'off' ? false : null;
    const primaryRaw = notifyPrimaryLocal.trim();
    const primaryParsed = primaryRaw === '' ? null : Number(primaryRaw);
    const secondaryRaw = notifySecondaryLocal.trim();
    const secondaryParsed = secondaryRaw === '' ? null : Number(secondaryRaw);
    if (primaryParsed !== null && (Number.isNaN(primaryParsed) || primaryParsed < 1)) return;
    if (secondaryParsed !== null && (Number.isNaN(secondaryParsed) || secondaryParsed < 1)) return;
    onUpdateNotify(item, {
      notify_enabled: enabled,
      notify_minutes_before: primaryParsed,
      notify_minutes_before_secondary: secondaryParsed,
    });
    setNotifyEditOpen(false);
  }

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
            <button type="button" className="opp-bid" onClick={openBidEditor}>
              {planned ? 'Modifier max' : 'Encherir'}
            </button>
          )}
          {onIgnore && !inBasket && (
            <button type="button" className="ghost" onClick={() => onIgnore(item)}>
              Ignorer
            </button>
          )}
          {onUpdateNotify && item.auction_end_at && (
            <button
              type="button"
              className={
                notifyExplicitlyOff
                  ? 'opp-bell off'
                  : hasNotifyOverride
                    ? 'opp-bell custom'
                    : 'opp-bell'
              }
              onClick={() => setNotifyEditOpen((value) => !value)}
              title={
                notifyExplicitlyOff
                  ? 'Notif desactivee pour cette carte'
                  : hasNotifyOverride
                    ? 'Reglage notif personnalise'
                    : 'Reglage notif (selon defaut compte)'
              }
            >
              <Bell size={13} />
            </button>
          )}
          <a href={item.url} target="_blank" rel="noreferrer" className="opp-ebay">
            eBay <ExternalLink size={13} />
          </a>
        </div>

        {bidEditOpen && (
          <form className="opp-bid-form" onSubmit={handleBidSubmit}>
            <label htmlFor={`bid-${item.id}`}>
              Max d'enchere ({item.currency})
            </label>
            <div className="opp-bid-form-row">
              <input
                id={`bid-${item.id}`}
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={bidValue}
                onChange={(event) => setBidValue(event.target.value)}
                placeholder="ex. 80"
              />
              <button type="submit">Confirmer</button>
              <button type="button" className="ghost" onClick={() => setBidEditOpen(false)}>
                Annuler
              </button>
            </div>
            <small>Vide = pas de max defini, juste planifier l'enchere.</small>
          </form>
        )}

        {notifyEditOpen && (
          <form className="opp-notify-form" onSubmit={handleNotifySubmit}>
            <label htmlFor={`notify-state-${item.id}`}>Notif Discord pour cette carte</label>
            <select
              id={`notify-state-${item.id}`}
              value={notifyEnabledLocal}
              onChange={(event) => setNotifyEnabledLocal(event.target.value as 'default' | 'on' | 'off')}
            >
              <option value="default">Suivre le defaut compte</option>
              <option value="on">Forcer ON</option>
              <option value="off">Forcer OFF (jamais notifier)</option>
            </select>
            <label htmlFor={`notify-prim-${item.id}`}>1ere alerte (min) <small>vide = compte</small></label>
            <input
              id={`notify-prim-${item.id}`}
              type="number"
              min="1"
              max="240"
              step="5"
              placeholder="ex. 60"
              value={notifyPrimaryLocal}
              onChange={(event) => setNotifyPrimaryLocal(event.target.value)}
            />
            <label htmlFor={`notify-sec-${item.id}`}>2eme alerte (min) <small>vide = compte</small></label>
            <input
              id={`notify-sec-${item.id}`}
              type="number"
              min="1"
              max="60"
              step="1"
              placeholder="ex. 5"
              value={notifySecondaryLocal}
              onChange={(event) => setNotifySecondaryLocal(event.target.value)}
            />
            <div className="opp-notify-actions">
              <button type="submit">Enregistrer</button>
              <button type="button" className="ghost" onClick={() => setNotifyEditOpen(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}

        <details className="opp-comps">
          <summary>
            <TrendingUp size={12} /> Voir comps - {compsLabel}
          </summary>
          <div className="opp-comps-tray">
            <a
              href={ebaySoldUrl(queries.precise)}
              target="_blank"
              rel="noreferrer"
              title={queries.precise}
            >
              eBay vendus (precis) <ExternalLink size={11} />
            </a>
            <a
              href={ebaySoldUrl(queries.broad)}
              target="_blank"
              rel="noreferrer"
              title={queries.broad}
            >
              eBay vendus (large) <ExternalLink size={11} />
            </a>
            <button
              type="button"
              className="opp-comps-130"
              title={`Copie "${queries.precise}" et ouvre 130point`}
              onClick={(event) => {
                event.preventDefault();
                openPoint130(queries.precise);
              }}
            >
              130point <ExternalLink size={11} />
            </button>
          </div>
          <div className="opp-comps-keywords">
            {keywords.player && <span>{keywords.player}</span>}
            {keywords.year && <span>{keywords.year}</span>}
            {keywords.context && <span className="opp-comps-context">{keywords.context}</span>}
            {keywords.isAuto && <span>auto</span>}
            {keywords.numberedDenom && <span>{keywords.numberedDenom}</span>}
            {keywords.isRookie && <span>RC</span>}
          </div>
        </details>
      </div>
    </article>
  );
}
