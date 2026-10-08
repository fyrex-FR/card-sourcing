import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { AlertDto } from "../api";
import { ListingCard } from "../components/ListingCard";
import { useToast } from "../components/Toast";
import { STATUS_LABEL, money, timeAgo } from "../format";

const KIND = {
  new: { label: "🆕 Nouvelle annonce", className: "badge-new" },
  under: { label: "📉 Sous ton prix max", className: "badge-under" },
  ending: { label: "⏰ Fin d'enchère", className: "badge-ending" },
} as const;

export function AlertsPage() {
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => api.alerts(150), refetchInterval: 60_000 });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const [filter, setFilter] = useState<number | "all">("all");
  const queryClient = useQueryClient();
  const toast = useToast();
  const home = status.data?.homeCurrency ?? "EUR";

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["alerts"] });
  const mute = useMutation({ mutationFn: (alert: AlertDto) => api.muteItem(alert.itemKey), onSuccess: () => (toast("Carte ignorée"), refresh()) });
  const watch = useMutation({
    mutationFn: (alert: AlertDto) => api.updateItem(alert.itemKey, { status: "watch" }),
    onSuccess: () => (toast("Ajoutée au suivi"), refresh(), queryClient.invalidateQueries({ queryKey: ["tracked"] })),
  });
  const block = useMutation({
    mutationFn: (alert: AlertDto) => api.blockSeller(alert.seller),
    onSuccess: (_, alert) => (toast(`${alert.seller} bloqué`), refresh(), queryClient.invalidateQueries({ queryKey: ["blocked"] })),
  });

  const searches = new Map((alerts.data ?? []).flatMap((a) => (a.search ? [[a.search.id, a.search.query] as const] : [])));
  const visible = (alerts.data ?? []).filter((a) => filter === "all" || a.search?.id === filter);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Alertes</h1>
          <p className="muted">Tout ce qui a été signalé, y compris ce qui n'a pas été envoyé sur Telegram faute de place.</p>
        </div>
      </div>

      {searches.size > 1 && (
        <div className="filter-chips" role="group" aria-label="Filtrer par recherche">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            Toutes
          </button>
          {[...searches].map(([id, query]) => (
            <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
              {query}
            </button>
          ))}
        </div>
      )}

      {alerts.isPending && <p className="muted">Chargement…</p>}
      {alerts.isError && <p className="notice error">{alerts.error.message}</p>}
      {alerts.data?.length === 0 && (
        <div className="empty">
          <p>
            <strong>Pas encore d'alerte.</strong>
          </p>
          <p className="muted">Dès qu'une annonce correspond à une de tes recherches, elle apparaît ici et sur Telegram.</p>
        </div>
      )}

      <div className="listing-grid">
        {visible.map((alert) => {
          const kind = alert.lastAlertKind ? KIND[alert.lastAlertKind] : null;
          return (
            <ListingCard
              key={alert.itemKey}
              title={alert.title}
              url={alert.url}
              imageUrl={alert.imageUrl}
              price={money(alert.lastTotal, home)}
              priceDetail={alert.importCost ? `rendu France, dont ${money(alert.importCost, home)} TVA/import` : "port inclus"}
              badge={
                <div className="badges">
                  {kind && <span className={`badge ${kind.className}`}>{kind.label}</span>}
                  {alert.status && <span className="badge badge-status">{STATUS_LABEL[alert.status]}</span>}
                </div>
              }
              endAt={alert.isAuction ? alert.endAt : null}
              dimmed={alert.muted}
              meta={[alert.search && `🔎 ${alert.search.query}`, alert.seller && `👤 ${alert.seller}`, `🕑 ${timeAgo(alert.lastAlertedAt)}`]}
              actions={
                <>
                  <a className="button small primary" href={alert.url} target="_blank" rel="noreferrer">
                    Voir sur eBay
                  </a>
                  {!alert.status && !alert.muted && (
                    <button className="button small" onClick={() => watch.mutate(alert)}>
                      ⭐ Suivre
                    </button>
                  )}
                  {!alert.muted && !alert.status && (
                    <button className="button small" onClick={() => mute.mutate(alert)}>
                      Ignorer
                    </button>
                  )}
                  {alert.seller && (
                    <button className="button small ghost" onClick={() => block.mutate(alert)}>
                      Bloquer vendeur
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </div>
    </>
  );
}
