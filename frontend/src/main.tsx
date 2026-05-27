import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Clock, ExternalLink, Eye, Flame, Layers, ListFilter, Menu, RefreshCw, Search, Star, Store, Target, Trash2, X } from 'lucide-react';
import { apiFetch } from './api/client';
import { useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';
import { OpportunityCard } from './components/OpportunityCard';
import type { SignalContext } from './lib/itemSignals';
import type { ScanResult, SellerAuctionResult, SellerFavorite, SourcingItem, Watchlist } from './types';
import './styles.css';

type FormState = {
  name: string;
  query: string;
  max_price: string;
  country_filter: string;
  buying_option: Watchlist['buying_option'];
};

type StatusFilter = 'all' | SourcingItem['status'];
type TimeFilter = 'all' | 'today' | 'tomorrow' | 'week' | 'ended' | 'undated';
type MobileView = 'action' | 'sellers' | 'cards';

const initialForm: FormState = {
  name: '',
  query: '',
  max_price: '',
  country_filter: 'CN',
  buying_option: 'AUCTION',
};

const statusLabels: Record<SourcingItem['status'], string> = {
  new: 'nouveau',
  watching: 'a suivre',
  bid_planned: 'a encherir',
  ignored: 'ignore',
  bought: 'achete',
  too_expensive: 'trop cher',
};

const buyingOptionLabels: Record<Watchlist['buying_option'], string> = {
  ALL: 'tout',
  AUCTION: 'encheres',
  FIXED_PRICE: 'achat immediat',
};

const timeFilterLabels: Record<TimeFilter, string> = {
  all: 'toutes fins',
  today: "aujourd'hui",
  tomorrow: 'demain',
  week: '7 jours',
  ended: 'terminees',
  undated: 'sans date',
};

function money(value: number | null, currency = 'USD') {
  if (value === null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}

function dateLabel(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function totalPrice(item: SourcingItem) {
  return Number(item.price ?? 0) + Number(item.shipping_price ?? 0);
}

function hoursUntil(value: string | null, now: number) {
  if (!value) return null;
  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return null;
  return (end - now) / 36e5;
}

function timeLeftLabel(value: string | null, now: number) {
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

function auctionUrgency(value: string | null, now: number) {
  if (!value) return '';
  const hoursLeft = (new Date(value).getTime() - now) / 36e5;
  if (hoursLeft <= 0) return 'ended';
  if (hoursLeft <= 6) return 'hot';
  if (hoursLeft <= 24) return 'soon';
  return '';
}

function isActiveItem(item: SourcingItem) {
  return item.status === 'new' || item.status === 'watching';
}

function auctionBucket(value: string | null, now: number): TimeFilter {
  if (!value) return 'undated';
  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return 'undated';
  if (end <= now) return 'ended';
  const current = new Date(now);
  const tomorrow = new Date(current);
  tomorrow.setHours(24, 0, 0, 0);
  const afterTomorrow = new Date(tomorrow);
  afterTomorrow.setDate(afterTomorrow.getDate() + 1);
  if (end < tomorrow.getTime()) return 'today';
  if (end < afterTomorrow.getTime()) return 'tomorrow';
  if (end <= now + 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'all';
}

function opportunityScore(item: SourcingItem, now: number, maxPrice: number | null, sellerCount = 1, favoriteSeller = false) {
  const price = totalPrice(item);
  const priceBase = maxPrice && maxPrice > 0 ? Math.max(0, 40 - (price / maxPrice) * 26) : Math.max(0, 34 - price / 4);
  const hoursLeft = hoursUntil(item.auction_end_at, now);
  const urgency = hoursLeft === null ? 2 : hoursLeft <= 0 ? -30 : hoursLeft <= 6 ? 30 : hoursLeft <= 24 ? 22 : hoursLeft <= 72 ? 12 : 5;
  const sellerBoost = Math.min(18, Math.max(0, sellerCount - 1) * 6);
  const bidPenalty = item.bid_count ? Math.min(12, item.bid_count * 1.5) : 0;
  const favoriteBoost = favoriteSeller ? 8 : 0;
  return Math.round(priceBase + urgency + sellerBoost + favoriteBoost - bidPenalty);
}

function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError(authError.message);
    setLoading(false);
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">CS</div>
        <h1>Card Sourcing</h1>
        <p>Acces prive pour surveiller les opportunites cartes depuis la Chine.</p>
        <input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <input type="password" placeholder="Mot de passe" value={password} onChange={(event) => setPassword(event.target.value)} required />
        {error && <span className="error">{error}</span>}
        <button type="submit" disabled={loading}>{loading ? 'Connexion...' : 'Se connecter'}</button>
      </form>
    </main>
  );
}

function App() {
  const { session, loading } = useAuth();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [items, setItems] = useState<SourcingItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [mobileView, setMobileView] = useState<MobileView>('action');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [favoriteSellers, setFavoriteSellers] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [sellerPanel, setSellerPanel] = useState<{
    seller: string;
    expanded: SourcingItem[]; // resultats eBay elargis (au-dela de la watchlist courante)
    expandedLoading: boolean;
    expandedError: string;
    expandedQuery: string;
  } | null>(null);

  const selectedWatchlist = useMemo(
    () => watchlists.find((watchlist) => watchlist.id === selectedId) ?? watchlists[0],
    [selectedId, watchlists],
  );

  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (timeFilter === 'all') return true;
      const bucket = auctionBucket(item.auction_end_at, now);
      return timeFilter === 'week' ? bucket === 'today' || bucket === 'tomorrow' || bucket === 'week' : bucket === timeFilter;
    });
    return [...filtered].sort((left, right) => {
      const leftEnd = left.auction_end_at ? new Date(left.auction_end_at).getTime() : Number.POSITIVE_INFINITY;
      const rightEnd = right.auction_end_at ? new Date(right.auction_end_at).getTime() : Number.POSITIVE_INFINITY;
      if (leftEnd !== rightEnd) return leftEnd - rightEnd;
      return totalPrice(left) - totalPrice(right);
    });
  }, [items, now, statusFilter, timeFilter]);

  const stats = useMemo(() => {
    const active = items.filter(isActiveItem);
    const bought = items.filter((item) => item.status === 'bought');
    const cheapest = active.reduce<SourcingItem | null>((best, item) => (!best || totalPrice(item) < totalPrice(best) ? item : best), null);
    const nextEnding = active
      .filter((item) => item.auction_end_at && new Date(item.auction_end_at).getTime() > now)
      .reduce<SourcingItem | null>((best, item) => (!best || new Date(item.auction_end_at!).getTime() < new Date(best.auction_end_at!).getTime() ? item : best), null);
    return {
      total: items.length,
      active: active.length,
      bought: bought.length,
      ignored: items.filter((item) => item.status === 'ignored' || item.status === 'too_expensive').length,
      cheapest,
      nextEnding,
      potentialSpend: active.reduce((sum, item) => sum + totalPrice(item), 0),
    };
  }, [items, now]);

  const sellerGroups = useMemo(() => {
    const groups = new Map<string, SourcingItem[]>();
    for (const item of items) {
      if (!item.seller_username || !isActiveItem(item)) continue;
      const bucket = auctionBucket(item.auction_end_at, now);
      if (bucket === 'ended') continue;
      const sellerItems = groups.get(item.seller_username) ?? [];
      sellerItems.push(item);
      groups.set(item.seller_username, sellerItems);
    }

    return [...groups.entries()]
      .map(([seller, sellerItems]) => {
        const endingSoon = sellerItems
          .filter((item) => item.auction_end_at)
          .sort((left, right) => new Date(left.auction_end_at!).getTime() - new Date(right.auction_end_at!).getTime())[0] ?? null;
        const sevenDayItems = sellerItems.filter((item) => {
          const bucket = auctionBucket(item.auction_end_at, now);
          return bucket === 'today' || bucket === 'tomorrow' || bucket === 'week';
        });
        return {
          seller,
          items: sellerItems,
          count: sellerItems.length,
          sevenDayCount: sevenDayItems.length,
          total: sellerItems.reduce((sum, item) => sum + totalPrice(item), 0),
          nextEnding: endingSoon,
          favorite: favoriteSellers.includes(seller),
        };
      })
      .sort((left, right) => {
        if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
        if (left.sevenDayCount !== right.sevenDayCount) return right.sevenDayCount - left.sevenDayCount;
        return right.total - left.total;
      })
      .slice(0, 8);
  }, [favoriteSellers, items, now]);

  const actionBoard = useMemo(() => {
    const activeItems = items.filter((item) => isActiveItem(item) && auctionBucket(item.auction_end_at, now) !== 'ended');
    const sellerCounts = new Map<string, number>();
    for (const item of activeItems) {
      if (!item.seller_username) continue;
      sellerCounts.set(item.seller_username, (sellerCounts.get(item.seller_username) ?? 0) + 1);
    }
    const maxPrice = selectedWatchlist?.max_price ?? null;
    const scored = activeItems
      .map((item) => ({
        item,
        score: opportunityScore(
          item,
          now,
          maxPrice,
          item.seller_username ? sellerCounts.get(item.seller_username) ?? 1 : 1,
          item.seller_username ? favoriteSellers.includes(item.seller_username) : false,
        ),
      }))
      .sort((left, right) => right.score - left.score);

    const urgent = scored
      .filter(({ item }) => {
        const hoursLeft = hoursUntil(item.auction_end_at, now);
        return hoursLeft !== null && hoursLeft > 0 && hoursLeft <= 48;
      })
      .slice(0, 5);

    const sellerMissions = sellerGroups
      .filter((group) => group.count >= 2 || group.favorite)
      .map((group) => ({
        ...group,
        score: Math.round(group.count * 14 + group.sevenDayCount * 12 + (group.favorite ? 20 : 0) - group.total / 20),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);

    const clean = items
      .filter((item) => item.status === 'new' && (auctionBucket(item.auction_end_at, now) === 'ended' || !item.image_url || !item.seller_username))
      .slice(0, 5);

    return { urgent, sellerMissions, clean, sellerCounts };
  }, [favoriteSellers, items, now, selectedWatchlist?.max_price, sellerGroups]);

  const signalCtxFor = (item: SourcingItem): SignalContext => ({
    now,
    maxPrice: selectedWatchlist?.max_price ?? null,
    sellerCount: item.seller_username ? actionBoard.sellerCounts.get(item.seller_username) ?? 1 : 1,
    favoriteSeller: item.seller_username ? favoriteSellers.includes(item.seller_username) : false,
  });

  async function load() {
    setError('');
    const [nextWatchlists, favorites] = await Promise.all([
      apiFetch<Watchlist[]>('/watchlists'),
      apiFetch<SellerFavorite[]>('/seller-favorites').catch(() => [] as SellerFavorite[]),
    ]);
    setWatchlists(nextWatchlists);
    setFavoriteSellers(favorites.map((favorite) => favorite.seller_username));
    const active = selectedId ?? nextWatchlists[0]?.id;
    setSelectedId(active ?? null);
    const suffix = active ? `?watchlist_id=${active}` : '';
    setItems(await apiFetch<SourcingItem[]>(`/items${suffix}`));
  }

  useEffect(() => {
    if (!session) return;
    load().catch((err) => setError(err.message));
  }, [session]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session || !selectedId) return;
    apiFetch<SourcingItem[]>(`/items?watchlist_id=${selectedId}`)
      .then(setItems)
      .catch((err) => setError(err.message));
  }, [selectedId, session]);

  async function createWatchlist(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError('');
    setScanMessage('');
    try {
      const created = await apiFetch<Watchlist>('/watchlists', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          query: form.query,
          max_price: form.max_price ? Number(form.max_price) : null,
          country_filter: form.country_filter.toUpperCase(),
          buying_option: form.buying_option,
        }),
      });
      setWatchlists((current) => [created, ...current]);
      setSelectedId(created.id);
      setForm(initialForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy('');
    }
  }

  async function scan(watchlistId: string) {
    setBusy(`scan:${watchlistId}`);
    setError('');
    setScanMessage('');
    try {
      const result = await apiFetch<ScanResult>(`/watchlists/${watchlistId}/scan`, { method: 'POST' });
      if (result.error) {
        setError(result.details ? `${result.error}: ${result.details}` : result.error);
        return;
      }
      const scanned = result.scanned_count ?? 0;
      const candidates = result.candidate_count ?? result.count;
      setScanMessage(
        result.count > 0
          ? `${result.count} annonce${result.count > 1 ? 's' : ''} importee${result.count > 1 ? 's' : ''}.`
          : `Scan termine : ${scanned} annonce${scanned > 1 ? 's' : ''} eBay trouvee${scanned > 1 ? 's' : ''}, ${candidates} compatible${candidates > 1 ? 's' : ''} avec les filtres.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy('');
    }
  }

  async function updateStatus(itemId: string, status: SourcingItem['status']) {
    const updated = await apiFetch<SourcingItem>(`/items/${itemId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setItems((current) => current.map((item) => (item.id === itemId ? updated : item)));
  }

  async function removeWatchlist(id: string) {
    await apiFetch(`/watchlists/${id}`, { method: 'DELETE' });
    setWatchlists((current) => current.filter((watchlist) => watchlist.id !== id));
    setItems([]);
    setSelectedId(null);
  }

  function openSellerPanel(seller: string) {
    const cleanSeller = seller.trim();
    if (!cleanSeller) return;
    setSellerPanel({
      seller: cleanSeller,
      expanded: [],
      expandedLoading: false,
      expandedError: '',
      expandedQuery: 'card',
    });
  }

  async function expandSellerSearch(query?: string) {
    if (!sellerPanel) return;
    const cleanQuery = (query ?? sellerPanel.expandedQuery).trim() || 'card';
    setSellerPanel({ ...sellerPanel, expandedLoading: true, expandedError: '', expandedQuery: cleanQuery });
    try {
      const result = await apiFetch<SellerAuctionResult>(
        `/sellers/${encodeURIComponent(sellerPanel.seller)}/ending-auctions?query=${encodeURIComponent(cleanQuery)}&days=30`,
      );
      if (result.error) {
        const errMsg: string = result.details ? `${result.error}: ${result.details}` : result.error;
        setSellerPanel((current) =>
          current && current.seller === sellerPanel.seller
            ? {
                ...current,
                expandedLoading: false,
                expandedError: errMsg,
              }
            : current,
        );
        return;
      }
      setSellerPanel((current) =>
        current && current.seller === sellerPanel.seller
          ? {
              ...current,
              expandedLoading: false,
              expandedError: '',
              expanded: result.results ?? [],
            }
          : current,
      );
    } catch (err) {
      setSellerPanel((current) =>
        current && current.seller === sellerPanel.seller
          ? {
              ...current,
              expandedLoading: false,
              expandedError: err instanceof Error ? err.message : 'Erreur inconnue',
            }
          : current,
      );
    }
  }

  async function toggleFavoriteSeller(seller: string) {
    const isFav = favoriteSellers.includes(seller);
    // Mise a jour optimiste
    setFavoriteSellers((current) => (isFav ? current.filter((item) => item !== seller) : [seller, ...current]));
    try {
      if (isFav) {
        await apiFetch(`/seller-favorites/${encodeURIComponent(seller)}`, { method: 'DELETE' });
      } else {
        await apiFetch('/seller-favorites', {
          method: 'POST',
          body: JSON.stringify({ seller_username: seller }),
        });
      }
    } catch (err) {
      // Rollback
      setFavoriteSellers((current) => (isFav ? [seller, ...current] : current.filter((item) => item !== seller)));
      setError(err instanceof Error ? err.message : 'Erreur favori');
    }
  }

  async function planBid(item: SourcingItem) {
    const current = item.max_bid !== null && item.max_bid !== undefined ? String(item.max_bid) : '';
    const input = window.prompt(`Montant max d'enchere pour "${item.title.slice(0, 60)}" (${item.currency})`, current);
    if (input === null) return;
    const trimmed = input.trim();
    const max_bid = trimmed === '' ? null : Number(trimmed);
    if (max_bid !== null && (Number.isNaN(max_bid) || max_bid < 0)) {
      setError('Montant invalide');
      return;
    }
    try {
      const updated = await apiFetch<SourcingItem>(`/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'bid_planned', max_bid }),
      });
      setItems((list) => list.map((entry) => (entry.id === item.id ? updated : entry)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur planification');
    }
  }

  async function saveNote(item: SourcingItem) {
    const input = window.prompt('Note privee', item.note ?? '');
    if (input === null) return;
    const note = input.trim() === '' ? null : input;
    try {
      const updated = await apiFetch<SourcingItem>(`/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      });
      setItems((list) => list.map((entry) => (entry.id === item.id ? updated : entry)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur note');
    }
  }

  // Items locaux pour le vendeur ouvert (issus du scan courant). Toujours dispo, zero appel API.
  const sellerLocalItems = useMemo(() => {
    if (!sellerPanel) return [] as SourcingItem[];
    return items
      .filter((item) => item.seller_username === sellerPanel.seller)
      .sort((a, b) => {
        const aEnd = a.auction_end_at ? new Date(a.auction_end_at).getTime() : Number.POSITIVE_INFINITY;
        const bEnd = b.auction_end_at ? new Date(b.auction_end_at).getTime() : Number.POSITIVE_INFINITY;
        return aEnd - bEnd;
      });
  }, [items, sellerPanel]);

  // Items elargis filtres pour ne pas dupliquer ceux deja en local (par external_id)
  const sellerExpandedItems = useMemo(() => {
    if (!sellerPanel) return [] as SourcingItem[];
    const knownIds = new Set(sellerLocalItems.map((item) => item.external_id).filter(Boolean));
    return sellerPanel.expanded.filter((item) => !item.external_id || !knownIds.has(item.external_id));
  }, [sellerLocalItems, sellerPanel]);

  const sellerBasket = useMemo(() => {
    const all = [...sellerLocalItems, ...sellerExpandedItems];
    return {
      count: all.length,
      total: all.reduce((sum, item) => sum + totalPrice(item), 0),
      nextEnding:
        all
          .filter((item) => item.auction_end_at && new Date(item.auction_end_at).getTime() > now)
          .sort((a, b) => new Date(a.auction_end_at!).getTime() - new Date(b.auction_end_at!).getTime())[0] ?? null,
      currency: all[0]?.currency ?? 'USD',
    };
  }, [now, sellerExpandedItems, sellerLocalItems]);

  if (loading) return <main className="center">Chargement...</main>;
  if (!session) return <LoginView />;

  return (
    <main className={sellerPanel ? 'app-shell seller-open' : 'app-shell'}>
      <aside className={mobileSearchOpen ? 'sidebar mobile-open' : 'sidebar'}>
        <div className="topbar">
          <div>
            <strong>Card Sourcing</strong>
            <span>{session.user.email}</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-button mobile-close" onClick={() => setMobileSearchOpen(false)} title="Fermer">
              <X size={17} />
            </button>
            <button className="icon-button" onClick={() => supabase.auth.signOut()} title="Deconnexion">
              <ExternalLink size={17} />
            </button>
          </div>
        </div>

        <form className="watch-form" onSubmit={createWatchlist}>
          <input placeholder="Nom" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <input placeholder="Recherche eBay" value={form.query} onChange={(event) => setForm({ ...form, query: event.target.value })} required />
          <div className="form-row">
            <input placeholder="Prix max" type="number" min="0" step="0.01" value={form.max_price} onChange={(event) => setForm({ ...form, max_price: event.target.value })} />
            <input placeholder="Pays" value={form.country_filter} onChange={(event) => setForm({ ...form, country_filter: event.target.value })} />
          </div>
          <div className="segmented" aria-label="Format eBay">
            {(['AUCTION', 'FIXED_PRICE', 'ALL'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={form.buying_option === option ? 'selected' : ''}
                onClick={() => setForm({ ...form, buying_option: option })}
              >
                {buyingOptionLabels[option]}
              </button>
            ))}
          </div>
          <button disabled={busy === 'create'}><Search size={16} /> Ajouter</button>
        </form>

        <div className="watchlist-list">
          {watchlists.map((watchlist) => (
            <button
              key={watchlist.id}
              className={watchlist.id === selectedWatchlist?.id ? 'watchlist active' : 'watchlist'}
              onClick={() => {
                setSelectedId(watchlist.id);
                setMobileSearchOpen(false);
              }}
            >
              <span>{watchlist.name}</span>
              <small>{watchlist.query}</small>
            </button>
          ))}
          {watchlists.length === 0 && (
            <div className="empty-sidebar">
              Cree une recherche, puis lance un scan pour remplir la collection.
            </div>
          )}
        </div>
      </aside>

      <section className={`content mobile-view-${mobileView}`}>
        <div className="mobile-command">
          <button className="ghost" onClick={() => setMobileSearchOpen(true)}>
            <Menu size={17} /> Recherches
          </button>
          {selectedWatchlist && (
            <button onClick={() => scan(selectedWatchlist.id)} disabled={busy === `scan:${selectedWatchlist.id}`}>
              <RefreshCw size={16} /> Scanner
            </button>
          )}
        </div>

        <header className="content-header">
          <div>
            <h1>{selectedWatchlist?.name ?? 'Aucune recherche'}</h1>
            <p>{selectedWatchlist ? `${selectedWatchlist.query} | ${selectedWatchlist.country_filter} | ${buyingOptionLabels[selectedWatchlist.buying_option ?? 'ALL']} | max ${money(selectedWatchlist.max_price)}` : 'Ajoute une recherche pour commencer.'}</p>
          </div>
          {selectedWatchlist && (
            <div className="actions">
              <button onClick={() => scan(selectedWatchlist.id)} disabled={busy === `scan:${selectedWatchlist.id}`}>
                <RefreshCw size={16} /> Scanner
              </button>
              <button className="ghost danger" onClick={() => removeWatchlist(selectedWatchlist.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </header>

        {error && <div className="notice">{error}</div>}
        {scanMessage && <div className="notice success">{scanMessage}</div>}

        {selectedWatchlist && (
          <>
            <nav className="mobile-tabs" aria-label="Vue mobile">
              {([
                ['action', 'A acheter'],
                ['sellers', 'Vendeurs'],
                ['cards', 'Toutes'],
              ] as const).map(([view, label]) => (
                <button key={view} className={mobileView === view ? 'selected' : ''} onClick={() => setMobileView(view)}>
                  {label}
                </button>
              ))}
            </nav>

            <section className={`mobile-focus ${mobileView === 'action' ? 'active' : ''}`}>
              <div className="mobile-section-title">
                <strong>Priorite maintenant</strong>
                <span>{actionBoard.urgent.length || visibleItems.length} carte{(actionBoard.urgent.length || visibleItems.length) > 1 ? 's' : ''}</span>
              </div>
              {(actionBoard.urgent.length ? actionBoard.urgent.map(({ item }) => item) : visibleItems.filter(isActiveItem).slice(0, 8)).map((item) => (
                <OpportunityCard
                  key={item.id}
                  item={item}
                  ctx={signalCtxFor(item)}
                  variant="compact"
                  onWatch={(target) => updateStatus(target.id, 'watching')}
                  onIgnore={(target) => updateStatus(target.id, 'ignored')}
                  onPlanBid={planBid}
                  onOpenSeller={(seller) => openSellerPanel(seller)}
                />
              ))}
              {visibleItems.length === 0 && <div className="empty-state compact">Lance un scan pour remplir la file d'action.</div>}
            </section>

            <section className={`mobile-focus ${mobileView === 'sellers' ? 'active' : ''}`}>
              <div className="mobile-section-title">
                <strong>Vendeurs a grouper</strong>
                <span>{sellerGroups.length} actif{sellerGroups.length > 1 ? 's' : ''}</span>
              </div>
              {sellerGroups.map((group) => (
                <article className={group.favorite ? 'seller-group favorite' : 'seller-group'} key={group.seller}>
                  <div className="seller-group-head">
                    <button className="seller-name" onClick={() => openSellerPanel(group.seller)}>
                      <Store size={15} /> {group.seller}
                    </button>
                    <button className={group.favorite ? 'star-button selected' : 'star-button'} onClick={() => toggleFavoriteSeller(group.seller)} title="Favori vendeur">
                      <Star size={15} />
                    </button>
                  </div>
                  <div className="seller-group-stats">
                    <span>{group.count} carte{group.count > 1 ? 's' : ''}</span>
                    <span>{group.sevenDayCount} fin J+7</span>
                    <strong>{money(group.total, group.items[0]?.currency ?? 'USD')}</strong>
                  </div>
                </article>
              ))}
            </section>

            <section className={`mobile-focus ${mobileView === 'cards' ? 'active' : ''}`}>
              <div className="mobile-filter-title"><ListFilter size={15} /> Filtres</div>
            </section>

            <div className="desktop-stack">
            <div className="last-scan-row">
              Dernier scan : {dateLabel(selectedWatchlist.last_scan_at)} ·
              {' '}{stats.active} carte{stats.active > 1 ? 's' : ''} active{stats.active > 1 ? 's' : ''}
              {stats.bought > 0 ? ` · ${stats.bought} achete${stats.bought > 1 ? 's' : ''}` : ''}
            </div>

            <section className="action-board">
              <div className="action-lane priority">
                <div className="lane-title">
                  <Flame size={16} />
                  <div>
                    <span>Maintenant</span>
                    <strong>A trancher avant la fin</strong>
                  </div>
                </div>
                {actionBoard.urgent.length === 0 && <div className="lane-empty">Rien d'urgent dans les 48h.</div>}
                {actionBoard.urgent.map(({ item }) => (
                  <OpportunityCard
                    key={item.id}
                    item={item}
                    ctx={signalCtxFor(item)}
                    variant="compact"
                    onWatch={(target) => updateStatus(target.id, 'watching')}
                    onIgnore={(target) => updateStatus(target.id, 'ignored')}
                    onPlanBid={planBid}
                    onOpenSeller={(seller) => openSellerPanel(seller)}
                  />
                ))}
              </div>

              <div className="action-lane">
                <div className="lane-title">
                  <Layers size={16} />
                  <div>
                    <span>Panier</span>
                    <strong>Vendeurs a concentrer</strong>
                  </div>
                </div>
                {actionBoard.sellerMissions.length === 0 && <div className="lane-empty">Pas encore de vendeur assez dense.</div>}
                {actionBoard.sellerMissions.map((group) => (
                  <article className="action-item seller-mission" key={group.seller}>
                    <div>
                      <strong>{group.seller}</strong>
                      <span>{group.count} cartes · {group.sevenDayCount} fins J+7 · {money(group.total, group.items[0]?.currency ?? 'USD')}</span>
                    </div>
                    <button onClick={() => openSellerPanel(group.seller)}>Explorer</button>
                  </article>
                ))}
              </div>

              <div className="action-lane">
                <div className="lane-title">
                  <Target size={16} />
                  <div>
                    <span>Menage</span>
                    <strong>A sortir du radar</strong>
                  </div>
                </div>
                {actionBoard.clean.length === 0 && <div className="lane-empty">Rien a nettoyer.</div>}
                {actionBoard.clean.map((item) => (
                  <article className="action-item" key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{auctionBucket(item.auction_end_at, now) === 'ended' ? 'terminee' : !item.image_url ? 'sans image' : 'vendeur inconnu'}</span>
                    </div>
                    <button onClick={() => updateStatus(item.id, 'ignored')}>Ignorer</button>
                  </article>
                ))}
              </div>
            </section>

            </div>

            <div className="filter-row cards-filter-row">
              {(['all', 'new', 'watching', 'bid_planned', 'bought', 'too_expensive', 'ignored'] as const).map((status) => (
                <button
                  key={status}
                  className={statusFilter === status ? 'filter selected' : 'filter'}
                  onClick={() => setStatusFilter(status)}
                >
                  {status === 'all' ? 'tout' : statusLabels[status]}
                </button>
              ))}
            </div>

            <div className="filter-row timeline-filters cards-filter-row">
              {(['all', 'today', 'tomorrow', 'week', 'ended', 'undated'] as const).map((filter) => (
                <button
                  key={filter}
                  className={timeFilter === filter ? 'filter selected' : 'filter'}
                  onClick={() => setTimeFilter(filter)}
                >
                  {timeFilterLabels[filter]}
                </button>
              ))}
            </div>
          </>
        )}

        <div className={mobileView === 'cards' ? 'items-grid mobile-cards-active' : 'items-grid'}>
          {visibleItems.map((item) => (
            <article className="item-card" key={item.id}>
              <div className="thumb">{item.image_url ? <img src={item.image_url} alt="" /> : <Eye size={28} />}</div>
              <div className="item-body">
                <div className="item-title">{item.title}</div>
                <div className="meta">
                  <strong>{money(totalPrice(item), item.currency)}</strong>
                  {item.shipping_price ? <span>dont port {money(item.shipping_price, item.currency)}</span> : <span>port inconnu</span>}
                  <span>{item.country || '??'}</span>
                  {item.buying_options?.length ? <span>{item.buying_options.includes('AUCTION') ? 'enchere' : item.buying_options.includes('FIXED_PRICE') ? 'achat immediat' : item.buying_options.join(', ')}</span> : null}
                  {item.auction_end_at && (
                    <span className={`countdown ${auctionUrgency(item.auction_end_at, now)}`}>
                      <Clock size={13} /> {timeLeftLabel(item.auction_end_at, now)}
                    </span>
                  )}
                  {item.bid_count !== null && item.bid_count !== undefined ? <span>{item.bid_count} enchere{item.bid_count > 1 ? 's' : ''}</span> : null}
                  {item.match_quality === 'partial' && item.match_query ? <span>match partiel: {item.match_query}</span> : null}
                  {item.seller_username ? (
                    <button className="seller-link" onClick={() => openSellerPanel(item.seller_username ?? '')}>
                      {item.seller_username}
                    </button>
                  ) : <span>vendeur inconnu</span>}
                  {item.condition && <span>{item.condition}</span>}
                  {item.max_bid !== null && item.max_bid !== undefined && (
                    <span className="max-bid">max {money(item.max_bid, item.currency)}</span>
                  )}
                </div>
                {item.note && (
                  <div className="item-note">{item.note}</div>
                )}
                <div className="status-row">
                  {(['new', 'watching', 'bid_planned', 'bought', 'too_expensive', 'ignored'] as const).map((status) => (
                    <button key={status} className={item.status === status ? 'chip selected' : 'chip'} onClick={() => updateStatus(item.id, status)}>
                      {statusLabels[status]}
                    </button>
                  ))}
                </div>
                <div className="card-actions">
                  <button className="secondary-action" onClick={() => planBid(item)}>
                    {item.max_bid ? `Modifier max ${money(item.max_bid, item.currency)}` : 'Definir max d\'enchere'}
                  </button>
                  <button className="secondary-action" onClick={() => saveNote(item)}>
                    {item.note ? 'Modifier note' : 'Ajouter note'}
                  </button>
                  {item.seller_username && (
                    <button className="secondary-action" onClick={() => openSellerPanel(item.seller_username ?? '')}>
                      <Store size={15} /> Voir vendeur
                    </button>
                  )}
                  <a href={item.url} target="_blank" rel="noreferrer">Ouvrir eBay</a>
                </div>
              </div>
            </article>
          ))}
        </div>

        {selectedWatchlist && visibleItems.length === 0 && (
          <div className="empty-state">
            <strong>Aucune carte dans cette vue.</strong>
            <span>{items.length === 0 ? 'Lance un scan pour importer les resultats eBay.' : 'Change de filtre ou marque des cartes dans ce statut.'}</span>
          </div>
        )}
      </section>
      {sellerPanel && (
        <aside className="seller-panel">
          <div className="seller-panel-header">
            <div>
              <span>Vendeur</span>
              <strong>{sellerPanel.seller}</strong>
            </div>
            <div className="panel-actions">
              <button
                className={favoriteSellers.includes(sellerPanel.seller) ? 'star-button selected' : 'star-button'}
                onClick={() => toggleFavoriteSeller(sellerPanel.seller)}
                title="Favori vendeur"
              >
                <Star size={15} />
              </button>
              <button className="ghost" onClick={() => setSellerPanel(null)}>Fermer</button>
            </div>
          </div>

          <div className="seller-summary">
            <div>
              <span>Cartes vues</span>
              <strong>{sellerBasket.count}</strong>
            </div>
            <div>
              <span>Panier potentiel</span>
              <strong>{money(sellerBasket.total, sellerBasket.currency)}</strong>
            </div>
          </div>

          {sellerBasket.nextEnding && (
            <div className="seller-next">
              <span>Prochaine fin</span>
              <strong>{timeLeftLabel(sellerBasket.nextEnding.auction_end_at, now)} - {sellerBasket.nextEnding.title}</strong>
            </div>
          )}

          {sellerLocalItems.length > 0 && (
            <>
              <div className="seller-section-title">
                <strong>Cartes de cette recherche ({sellerLocalItems.length})</strong>
                <a href={`https://www.ebay.com/sch/i.html?_ssn=${encodeURIComponent(sellerPanel.seller)}&LH_Auction=1`} target="_blank" rel="noreferrer">
                  Toutes ses ventes eBay <ExternalLink size={12} />
                </a>
              </div>
              <div className="seller-items">
                {sellerLocalItems.map((item) => (
                  <article className="seller-item" key={item.id}>
                    <div className="thumb small">{item.image_url ? <img src={item.image_url} alt="" /> : <Eye size={20} />}</div>
                    <div>
                      <strong>{item.title}</strong>
                      <div className="meta">
                        <span>{money(totalPrice(item), item.currency)}</span>
                        {item.auction_end_at && (
                          <span className={`countdown ${auctionUrgency(item.auction_end_at, now)}`}>
                            <Clock size={13} /> {timeLeftLabel(item.auction_end_at, now)}
                          </span>
                        )}
                        {item.bid_count !== null && item.bid_count !== undefined ? <span>{item.bid_count} bid{item.bid_count > 1 ? 's' : ''}</span> : null}
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer">Ouvrir eBay</a>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          <div className="seller-section-title">
            <strong>Elargir sur eBay</strong>
          </div>
          <form
            className="seller-search"
            onSubmit={(event) => {
              event.preventDefault();
              expandSellerSearch();
            }}
          >
            <input
              value={sellerPanel.expandedQuery}
              onChange={(event) => setSellerPanel({ ...sellerPanel, expandedQuery: event.target.value })}
              placeholder='ex. "card", "duncan", "auto"'
            />
            <button disabled={sellerPanel.expandedLoading}>
              <Search size={15} /> {sellerPanel.expandedLoading ? '...' : 'Chercher'}
            </button>
          </form>

          {sellerPanel.expandedError && <div className="notice">{sellerPanel.expandedError}</div>}
          {sellerPanel.expandedLoading && <div className="empty-state compact">Recherche eBay...</div>}

          {sellerExpandedItems.length > 0 && (
            <div className="seller-items">
              {sellerExpandedItems.map((item) => (
                <article className="seller-item" key={item.external_id ?? item.url}>
                  <div className="thumb small">{item.image_url ? <img src={item.image_url} alt="" /> : <Eye size={20} />}</div>
                  <div>
                    <strong>{item.title}</strong>
                    <div className="meta">
                      <span>{money(totalPrice(item), item.currency)}</span>
                      {item.auction_end_at && (
                        <span className={`countdown ${auctionUrgency(item.auction_end_at, now)}`}>
                          <Clock size={13} /> {timeLeftLabel(item.auction_end_at, now)}
                        </span>
                      )}
                      {item.bid_count !== null && item.bid_count !== undefined ? <span>{item.bid_count} bid{item.bid_count > 1 ? 's' : ''}</span> : null}
                    </div>
                    <a href={item.url} target="_blank" rel="noreferrer">Ouvrir eBay</a>
                  </div>
                </article>
              ))}
            </div>
          )}

          {sellerLocalItems.length === 0 && sellerExpandedItems.length === 0 && !sellerPanel.expandedLoading && (
            <div className="empty-state compact">
              Aucune carte de ce vendeur dans la recherche courante.<br />
              Lance une recherche eBay au-dessus pour voir ses ventes.
            </div>
          )}
        </aside>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
