import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Clock, ExternalLink, Eye, RefreshCw, Search, Trash2 } from 'lucide-react';
import { apiFetch } from './api/client';
import { useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';
import type { ScanResult, SourcingItem, Watchlist } from './types';
import './styles.css';

type FormState = {
  name: string;
  query: string;
  max_price: string;
  country_filter: string;
  buying_option: Watchlist['buying_option'];
};

type StatusFilter = 'all' | SourcingItem['status'];

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
  ignored: 'ignore',
  bought: 'achete',
  too_expensive: 'trop cher',
};

const buyingOptionLabels: Record<Watchlist['buying_option'], string> = {
  ALL: 'tout',
  AUCTION: 'encheres',
  FIXED_PRICE: 'achat immediat',
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
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const selectedWatchlist = useMemo(
    () => watchlists.find((watchlist) => watchlist.id === selectedId) ?? watchlists[0],
    [selectedId, watchlists],
  );

  const visibleItems = useMemo(() => {
    const filtered = statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter);
    return [...filtered].sort((left, right) => {
      const leftEnd = left.auction_end_at ? new Date(left.auction_end_at).getTime() : Number.POSITIVE_INFINITY;
      const rightEnd = right.auction_end_at ? new Date(right.auction_end_at).getTime() : Number.POSITIVE_INFINITY;
      if (leftEnd !== rightEnd) return leftEnd - rightEnd;
      return totalPrice(left) - totalPrice(right);
    });
  }, [items, statusFilter]);

  const stats = useMemo(() => {
    const active = items.filter((item) => item.status === 'new' || item.status === 'watching');
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

  async function load() {
    setError('');
    const nextWatchlists = await apiFetch<Watchlist[]>('/watchlists');
    setWatchlists(nextWatchlists);
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

  if (loading) return <main className="center">Chargement...</main>;
  if (!session) return <LoginView />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="topbar">
          <div>
            <strong>Card Sourcing</strong>
            <span>{session.user.email}</span>
          </div>
          <button className="icon-button" onClick={() => supabase.auth.signOut()} title="Deconnexion">
            <ExternalLink size={17} />
          </button>
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
              onClick={() => setSelectedId(watchlist.id)}
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

      <section className="content">
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
            <div className="stat-grid">
              <div className="stat">
                <span>Total cartes</span>
                <strong>{stats.total}</strong>
              </div>
              <div className="stat">
                <span>A surveiller</span>
                <strong>{stats.active}</strong>
              </div>
              <div className="stat">
                <span>Achetees</span>
                <strong>{stats.bought}</strong>
              </div>
              <div className="stat">
                <span>Budget actif</span>
                <strong>{money(stats.potentialSpend, stats.cheapest?.currency ?? 'USD')}</strong>
              </div>
            </div>

            <div className="insight-strip">
              <div>
                <span>Meilleure entree</span>
                <strong>{stats.cheapest ? `${money(totalPrice(stats.cheapest), stats.cheapest.currency)} - ${stats.cheapest.title}` : 'Aucune carte active'}</strong>
              </div>
              <div>
                <span>Prochaine fin</span>
                <strong>{stats.nextEnding ? `${timeLeftLabel(stats.nextEnding.auction_end_at, now)} - ${money(totalPrice(stats.nextEnding), stats.nextEnding.currency)} - ${stats.nextEnding.title}` : 'Aucune enchere datee'}</strong>
              </div>
              <span>Dernier scan : {dateLabel(selectedWatchlist.last_scan_at)}</span>
            </div>

            <div className="filter-row">
              {(['all', 'new', 'watching', 'bought', 'too_expensive', 'ignored'] as const).map((status) => (
                <button
                  key={status}
                  className={statusFilter === status ? 'filter selected' : 'filter'}
                  onClick={() => setStatusFilter(status)}
                >
                  {status === 'all' ? 'tout' : statusLabels[status]}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="items-grid">
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
                  <span>{item.seller_username || 'vendeur inconnu'}</span>
                  {item.condition && <span>{item.condition}</span>}
                </div>
                <div className="status-row">
                  {(['new', 'watching', 'bought', 'too_expensive', 'ignored'] as const).map((status) => (
                    <button key={status} className={item.status === status ? 'chip selected' : 'chip'} onClick={() => updateStatus(item.id, status)}>
                      {statusLabels[status]}
                    </button>
                  ))}
                </div>
                <a href={item.url} target="_blank" rel="noreferrer">Ouvrir eBay</a>
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
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
