import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import { QuotaBar, Switch } from "../components/Controls";
import { useToast } from "../components/Toast";
import { timeAgo } from "../format";

export function SettingsPage() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 60_000 });
  const blocked = useQuery({ queryKey: ["blocked"], queryFn: api.blockedSellers });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [seller, setSeller] = useState("");

  const pause = useMutation({
    mutationFn: api.setPaused,
    onSuccess: ({ paused }) => (toast(paused ? "Alertes en pause" : "Alertes relancées"), queryClient.invalidateQueries({ queryKey: ["status"] })),
  });
  const block = useMutation({
    mutationFn: api.blockSeller,
    onSuccess: () => (setSeller(""), queryClient.invalidateQueries({ queryKey: ["blocked"] })),
    onError: (error) => toast(error.message, "error"),
  });
  const unblock = useMutation({ mutationFn: api.unblockSeller, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blocked"] }) });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => queryClient.setQueryData(["me"], false) });

  const addSeller = (event: FormEvent) => {
    event.preventDefault();
    if (seller.trim()) block.mutate(seller.trim());
  };

  const s = status.data;
  return (
    <>
      <div className="page-header">
        <h1>Réglages</h1>
      </div>

      <section className="panel">
        <div className="panel-row">
          <div>
            <h2>Alertes</h2>
            <p className="muted">{s?.paused ? "En pause : aucune vérification eBay." : "Actives."}</p>
          </div>
          {s && <Switch checked={!s.paused} onChange={(on) => pause.mutate(!on)} label="Alertes actives" />}
        </div>
        {s && (
          <dl className="facts">
            <div>
              <dt>Recherches actives</dt>
              <dd>{s.activeSearches}</dd>
            </div>
            <div>
              <dt>Vérification</dt>
              <dd>toutes les {Math.max(1, Math.round(s.intervalSeconds / 60))} min</dd>
            </div>
            <div>
              <dt>Dernier passage</dt>
              <dd>{timeAgo(s.lastCycleAt)}</dd>
            </div>
            <div>
              <dt>Appels par passage</dt>
              <dd>{s.callsPerCycle}</dd>
            </div>
          </dl>
        )}
        {s && <QuotaBar used={s.callsToday} budget={s.dailyBudget} />}
        <p className="muted small">
          L'intervalle s'adapte tout seul pour rester sous le quota eBay : plus tu as de recherches et de sites, plus il s'allonge.
        </p>
      </section>

      <section className="panel">
        <h2>Vendeurs bloqués</h2>
        <p className="muted">Leurs annonces ne déclenchent plus d'alerte.</p>
        <form className="inline-form" onSubmit={addSeller}>
          <input value={seller} onChange={(event) => setSeller(event.target.value)} placeholder="Pseudo eBay du vendeur" aria-label="Pseudo eBay du vendeur" />
          <button className="button" disabled={!seller.trim()}>
            Bloquer
          </button>
        </form>
        {blocked.data?.length === 0 && <p className="muted small">Aucun vendeur bloqué.</p>}
        <ul className="plain-list">
          {blocked.data?.map((name) => (
            <li key={name}>
              <span>{name}</span>
              <button className="button small ghost" onClick={() => unblock.mutate(name)}>
                Débloquer
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Compte</h2>
        <p className="muted">Les alertes arrivent sur ton Telegram. Tape /login dans le bot pour te reconnecter depuis un autre appareil.</p>
        <button className="button ghost" onClick={() => logout.mutate()}>
          Se déconnecter
        </button>
      </section>
    </>
  );
}
