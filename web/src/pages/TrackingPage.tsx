import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { ItemPatch, TrackStatus, TrackedItemDto } from "../api";
import { Segmented } from "../components/Controls";
import { ListingCard } from "../components/ListingCard";
import { useToast } from "../components/Toast";
import { STATUS_LABEL, money, sellerStoreUrl } from "../format";

const SECTIONS: { status: TrackStatus; title: string; empty: string }[] = [
  { status: "bid", title: "🎯 À enchérir", empty: "Passe une carte en « À enchérir » pour fixer ton plafond." },
  { status: "watch", title: "⭐ Suivies", empty: "Touche « Suivre » sur une alerte (ici ou sur Telegram)." },
  { status: "bought", title: "✅ Achetées", empty: "Rien d'acheté pour l'instant." },
];

export function TrackingPage() {
  const tracked = useQuery({ queryKey: ["tracked"], queryFn: api.tracked, refetchInterval: 60_000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const [view, setView] = useState<"status" | "seller">("status");
  const home = status.data?.homeCurrency ?? "EUR";
  const items = tracked.data ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Suivi</h1>
          <p className="muted">
            Les enchères suivies te sont rappelées sur Telegram {settings.data?.reminderMinutes ?? 10} min avant la fin, avec la mise max à
            saisir pour respecter ton plafond.
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <Segmented
          label="Affichage"
          value={view}
          onChange={setView}
          options={[
            { value: "status", label: "Par statut" },
            { value: "seller", label: "Par vendeur" },
          ]}
        />
      )}

      {tracked.isPending && <p className="muted">Chargement…</p>}
      {tracked.isError && <p className="notice error">{tracked.error.message}</p>}
      {tracked.isSuccess && items.length === 0 && (
        <div className="empty">
          <p>
            <strong>Aucune carte suivie.</strong>
          </p>
          <p className="muted">Sur une alerte, touche « ⭐ Suivre » (ici ou sur Telegram). Tu pourras ensuite fixer ton plafond d'enchère.</p>
          <Link to="/alertes" className="button">
            Voir les alertes
          </Link>
        </div>
      )}

      {items.length > 0 && view === "status" &&
        SECTIONS.map((section) => {
          const sectionItems = items.filter((item) => item.status === section.status);
          return (
            <section key={section.status} className="tracking-section">
              <h2>
                {section.title} <span className="count">{sectionItems.length}</span>
              </h2>
              {sectionItems.length === 0 ? (
                <p className="muted small">{section.empty}</p>
              ) : (
                <div className="listing-grid">
                  {sectionItems.map((item) => (
                    <TrackedCard key={item.itemKey} item={item} home={home} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

      {items.length > 0 && view === "seller" && <BySeller items={items} home={home} />}
    </>
  );
}

function BySeller({ items, home }: { items: TrackedItemDto[]; home: string }) {
  const groups = new Map<string, TrackedItemDto[]>();
  for (const item of items.filter((i) => i.status !== "bought")) {
    const key = item.seller || "vendeur inconnu";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  if (sorted.length === 0) return <p className="muted">Aucune carte en cours (hors achetées).</p>;

  return (
    <>
      <p className="muted small">Plusieurs cartes chez un même vendeur ? Demande-lui un envoi groupé pour payer le port une seule fois.</p>
      {sorted.map(([seller, sellerItems]) => {
        const total = sellerItems.reduce((sum, item) => sum + (item.lastTotal ?? 0), 0);
        return (
          <section key={seller} className="panel seller-group">
            <div className="panel-row">
              <div>
                <h2>👤 {seller}</h2>
                <p className="muted small">
                  {sellerItems.length} carte{sellerItems.length > 1 ? "s" : ""} · {money(total, home)} rendu France au prix actuel
                </p>
              </div>
              {seller !== "vendeur inconnu" && (
                <a className="button small" href={sellerStoreUrl(seller)} target="_blank" rel="noreferrer">
                  Sa boutique ↗
                </a>
              )}
            </div>
            <ul className="plain-list">
              {sellerItems.map((item) => (
                <li key={item.itemKey}>
                  <a href={item.url} target="_blank" rel="noreferrer" className="truncate">
                    {item.status ? STATUS_LABEL[item.status].split(" ")[0] : ""} {item.title}
                  </a>
                  <strong>{money(item.lastTotal, home)}</strong>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function TrackedCard({ item, home }: { item: TrackedItemDto; home: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [maxBid, setMaxBid] = useState(item.maxBid === null ? "" : String(item.maxBid));
  const [note, setNote] = useState(item.note ?? "");
  useEffect(() => setMaxBid(item.maxBid === null ? "" : String(item.maxBid)), [item.maxBid]);

  const update = useMutation({
    mutationFn: (patch: ItemPatch) => api.updateItem(item.itemKey, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tracked"] }),
    onError: (error) => toast(error.message, "error"),
  });

  const saveMaxBid = () => {
    const value = Number(maxBid.replace(",", "."));
    const next = maxBid.trim() && value > 0 ? value : null;
    if (next !== item.maxBid) update.mutate({ maxBid: next });
  };
  const saveNote = () => {
    const next = note.trim() || null;
    if (next !== item.note) update.mutate({ note: next });
  };

  const detail = item.price !== null && item.currency ? `${money(item.price, item.currency)} + port ${money(item.shipping, item.currency)}` : undefined;
  const overCeiling = item.maxBid !== null && item.lastTotal !== null && item.lastTotal > item.maxBid;

  return (
    <ListingCard
      title={item.title}
      url={item.url}
      imageUrl={item.imageUrl}
      price={money(item.lastTotal, home)}
      priceDetail={detail ? `rendu France · ${detail}` : "rendu France"}
      endAt={item.isAuction ? item.endAt : null}
      meta={[item.isAuction ? `🔨 ${item.bidCount ?? 0} offre${(item.bidCount ?? 0) > 1 ? "s" : ""}` : "🛒 Achat immédiat", item.seller && `👤 ${item.seller}`]}
      actions={
        <div className="tracked-controls">
          <Segmented
            label="Statut"
            value={item.status ?? "watch"}
            onChange={(status) => update.mutate({ status })}
            options={[
              { value: "watch", label: "Suivie" },
              { value: "bid", label: "Enchérir" },
              { value: "bought", label: "Achetée" },
            ]}
          />
          {item.status === "bid" && (
            <div className="bid-box">
              <label className="input-suffix">
                <input
                  inputMode="decimal"
                  value={maxBid}
                  onChange={(event) => setMaxBid(event.target.value.replace(/[^\d.,]/g, ""))}
                  onBlur={saveMaxBid}
                  onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
                  placeholder="Plafond"
                  aria-label="Plafond rendu France"
                />
                <span>{home} max rendu France</span>
              </label>
              {item.maxBidListing !== null && item.currency && (
                <p className={overCeiling ? "row-error small" : "small"}>
                  {overCeiling ? "⚠️ Déjà au-dessus de ton plafond. " : "👉 "}
                  Mise max à saisir sur eBay : <strong>{money(item.maxBidListing, item.currency)}</strong>
                </p>
              )}
            </div>
          )}
          <input
            className="note-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={saveNote}
            onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            placeholder="Note (client, état, idée de revente…)"
            aria-label="Note"
          />
          <div className="listing-actions">
            <a className="button small primary" href={item.url} target="_blank" rel="noreferrer">
              Voir sur eBay
            </a>
            <button className="button small ghost" onClick={() => update.mutate({ status: null })}>
              Retirer du suivi
            </button>
          </div>
        </div>
      }
    />
  );
}
