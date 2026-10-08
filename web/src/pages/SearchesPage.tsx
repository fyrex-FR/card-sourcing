import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import type { SearchDto } from "../api";
import { QuotaBar, Switch } from "../components/Controls";
import { useToast } from "../components/Toast";
import { BUYING_LABEL, SELLER_COUNTRIES, money, timeAgo } from "../format";

export function SearchesPage() {
  const searches = useQuery({ queryKey: ["searches"], queryFn: api.searches, refetchInterval: 60_000 });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 60_000 });
  const queryClient = useQueryClient();
  const toast = useToast();

  const resume = useMutation({
    mutationFn: () => api.setPaused(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["status"] }),
  });
  const toggle = useMutation({
    mutationFn: (search: SearchDto) => api.updateSearch(search.id, { active: !search.active }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["searches"] });
      void queryClient.invalidateQueries({ queryKey: ["status"] });
      toast(updated.active ? "Recherche réactivée" : "Recherche en pause");
    },
    onError: (error) => toast(error.message, "error"),
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Recherches</h1>
          {status.data && (
            <p className="muted">
              {status.data.activeSearches === 0
                ? "Aucune recherche active"
                : `Vérifiées toutes les ${Math.max(1, Math.round(status.data.intervalSeconds / 60))} min · dernier passage ${timeAgo(status.data.lastCycleAt)}`}
            </p>
          )}
        </div>
        <Link to="/recherches/nouvelle" className="button primary">
          + Nouvelle
        </Link>
      </div>

      {status.data?.paused && (
        <div className="banner">
          <span>⏸ Toutes les alertes sont en pause.</span>
          <button className="button small" onClick={() => resume.mutate()}>
            Reprendre
          </button>
        </div>
      )}

      {searches.isPending && <p className="muted">Chargement…</p>}
      {searches.isError && <p className="notice error">{searches.error.message}</p>}

      {searches.data?.length === 0 && (
        <div className="empty">
          <p>
            <strong>Aucune recherche pour l'instant.</strong>
          </p>
          <p className="muted">
            Crée une recherche (par exemple « wembanyama prizm silver », 80 € max port inclus) et tu seras prévenu sur Telegram dès
            qu'une annonce correspond.
          </p>
          <Link to="/recherches/nouvelle" className="button primary">
            Créer ma première recherche
          </Link>
        </div>
      )}

      <ul className="search-list">
        {searches.data?.map((search) => (
          <SearchRow key={search.id} search={search} homeCurrency={status.data?.homeCurrency ?? "EUR"} onToggle={() => toggle.mutate(search)} />
        ))}
      </ul>

      {status.data && status.data.activeSearches > 0 && <QuotaBar used={status.data.callsToday} budget={status.data.dailyBudget} />}
    </>
  );
}

function SearchRow({ search, homeCurrency, onToggle }: { search: SearchDto; homeCurrency: string; onToggle: () => void }) {
  const navigate = useNavigate();
  const tags = [
    search.maxPrice === null ? "Pas de prix max" : `≤ ${money(search.maxPrice, homeCurrency)}`,
    search.marketplaces.includes("VINTED") ? "Vinted" : BUYING_LABEL[search.buying],
    !search.marketplaces.includes("VINTED") && `eBay ${search.marketplaces.map((m) => m.replace("EBAY_", "")).join(", ")}`,
    search.country && `Vendeurs : ${SELLER_COUNTRIES.find(([code]) => code === search.country)?.[1] ?? search.country}`,
    search.excludes.length > 0 && `${search.excludes.length} mot${search.excludes.length > 1 ? "s" : ""} exclu${search.excludes.length > 1 ? "s" : ""}`,
  ].filter(Boolean);

  return (
    <li className={`search-row ${search.active ? "" : "paused"}`} onClick={() => navigate(`/recherches/${search.id}`)}>
      <div className="search-row-main">
        <Link to={`/recherches/${search.id}`} className="search-title" onClick={(event) => event.stopPropagation()}>
          {search.query}
        </Link>
        <div className="tags">
          {tags.map((tag) => (
            <span key={String(tag)} className="tag">
              {tag}
            </span>
          ))}
        </div>
        {search.lastError ? (
          <p className="row-error">⚠️ {search.lastError}</p>
        ) : (
          <p className="muted small">{search.active ? `Vérifiée ${timeAgo(search.lastRunAt)}` : "En pause"}</p>
        )}
      </div>
      <Switch checked={search.active} onChange={onToggle} label={search.active ? "Mettre en pause" : "Réactiver"} />
    </li>
  );
}
