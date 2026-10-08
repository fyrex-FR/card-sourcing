import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import type { SearchDto, SearchInput } from "../api";
import { ChipsInput, Segmented } from "../components/Controls";
import { ListingCard, priceParts, sellerMeta } from "../components/ListingCard";
import { useToast } from "../components/Toast";
import { MARKETPLACE_LABEL, SELLER_COUNTRIES, timeAgo } from "../format";

interface FormState {
  query: string;
  maxPrice: string;
  buying: SearchInput["buying"];
  country: string;
  excludes: string[];
  requiredWords: string[];
  grading: SearchInput["grading"];
  excludeLots: boolean;
  minSellerFeedbackPct: string;
  minSellerFeedbackScore: string;
  endingWindowMin: string;
  marketplaces: string[];
}

const numberOrNull = (raw: string) => {
  const value = Number(raw.replace(",", "."));
  return raw.trim() && Number.isFinite(value) && value > 0 ? value : null;
};

const toForm = (search: SearchDto): FormState => ({
  query: search.query,
  maxPrice: search.maxPrice === null ? "" : String(search.maxPrice),
  buying: search.buying,
  country: search.country ?? "",
  excludes: search.excludes,
  requiredWords: search.requiredWords,
  grading: search.grading,
  excludeLots: search.excludeLots,
  minSellerFeedbackPct: search.minSellerFeedbackPct === null ? "" : String(search.minSellerFeedbackPct),
  minSellerFeedbackScore: search.minSellerFeedbackScore === null ? "" : String(search.minSellerFeedbackScore),
  endingWindowMin: String(search.endingWindowMin),
  marketplaces: search.marketplaces,
});

function toInput(form: FormState): SearchInput {
  const score = numberOrNull(form.minSellerFeedbackScore);
  return {
    query: form.query.trim(),
    maxPrice: numberOrNull(form.maxPrice),
    buying: form.buying,
    country: form.country || null,
    excludes: form.excludes,
    requiredWords: form.requiredWords,
    grading: form.grading,
    excludeLots: form.excludeLots,
    minSellerFeedbackPct: numberOrNull(form.minSellerFeedbackPct),
    minSellerFeedbackScore: score === null ? null : Math.round(score),
    endingWindowMin: Number(form.endingWindowMin) || 60,
    marketplaces: form.marketplaces,
  };
}

export function SearchEditorPage() {
  const { id } = useParams();
  const searchId = id ? Number(id) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const searches = useQuery({ queryKey: ["searches"], queryFn: api.searches, enabled: searchId !== null });
  const existing = searches.data?.find((s) => s.id === searchId);

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (form) return;
    if (existing) setForm(toForm(existing));
    else if (searchId === null && status.data) {
      setForm({
        query: "",
        maxPrice: "",
        buying: "ALL",
        country: "",
        excludes: [],
        requiredWords: [],
        grading: "ANY",
        excludeLots: false,
        minSellerFeedbackPct: "",
        minSellerFeedbackScore: "",
        endingWindowMin: "60",
        marketplaces: status.data.defaultMarketplaces,
      });
    }
  }, [existing, searchId, status.data, form]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["searches"] });
    void queryClient.invalidateQueries({ queryKey: ["status"] });
  };

  const save = useMutation({
    mutationFn: (input: SearchInput) => (searchId === null ? api.createSearch(input) : api.updateSearch(searchId, input)),
    onSuccess: () => {
      invalidate();
      toast(searchId === null ? "Recherche créée. Le résumé des annonces déjà en ligne arrive sur Telegram." : "Modifications enregistrées");
      navigate("/");
    },
    onError: (error) => toast(error.message, "error"),
  });
  const preview = useMutation({ mutationFn: api.preview, onError: (error) => toast(error.message, "error") });
  const check = useMutation({
    mutationFn: () => api.checkSearch(searchId!),
    onSuccess: ({ sent }) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast(sent > 0 ? `${sent} alerte${sent > 1 ? "s" : ""} envoyée${sent > 1 ? "s" : ""} sur Telegram` : "Rien de nouveau");
    },
    onError: (error) => toast(error.message, "error"),
  });
  const toggle = useMutation({
    mutationFn: () => api.updateSearch(searchId!, { active: !existing!.active }),
    onSuccess: (updated) => (invalidate(), toast(updated.active ? "Recherche réactivée" : "Recherche en pause")),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSearch(searchId!),
    onSuccess: () => (invalidate(), toast("Recherche supprimée"), navigate("/")),
  });

  if (searchId !== null && searches.isSuccess && !existing) {
    return (
      <div className="empty">
        <p>Cette recherche n'existe plus.</p>
        <Link to="/" className="button">
          Retour
        </Link>
      </div>
    );
  }
  if (!form || !status.data) return <p className="muted">Chargement…</p>;

  const home = status.data.homeCurrency;
  const input = toInput(form);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm({ ...form, [key]: value });
    preview.reset();
  };
  const watchesEnding = input.buying !== "FIXED_PRICE" && input.maxPrice !== null;
  const calls = (watchesEnding ? 2 : 1) * input.marketplaces.length;
  const valid = input.query.length > 0 && input.marketplaces.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) save.mutate(input);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/" className="back">
            ← Recherches
          </Link>
          <h1>{searchId === null ? "Nouvelle recherche" : existing?.query}</h1>
          {existing && (
            <p className="muted">
              {existing.active ? `Active · vérifiée ${timeAgo(existing.lastRunAt)}` : "En pause"}
              {existing.lastError && <span className="row-error"> · ⚠️ {existing.lastError}</span>}
            </p>
          )}
        </div>
      </div>

      <form className="editor" onSubmit={submit}>
        <section className="panel">
          <label className="field">
            <span>Mots-clés</span>
            <input
              value={form.query}
              onChange={(event) => set("query", event.target.value)}
              placeholder="wembanyama prizm silver psa 10"
              autoFocus={searchId === null}
              required
            />
            <small>Comme dans la barre de recherche eBay.</small>
          </label>

          <label className="field">
            <span>Prix max, rendu France</span>
            <div className="input-suffix">
              <input
                inputMode="decimal"
                value={form.maxPrice}
                onChange={(event) => set("maxPrice", event.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="Pas de limite"
              />
              <span>{home}</span>
            </div>
            <small>
              {input.maxPrice === null
                ? "Sans prix max, tu es alerté pour chaque nouvelle annonce, et il n'y a pas d'alerte de fin d'enchère."
                : "Carte + port vers la France + TVA d'import si le vendeur est hors UE (réglable dans Réglages)."}
            </small>
          </label>

          <div className="field">
            <span>Type d'annonce</span>
            <Segmented
              label="Type d'annonce"
              value={form.buying}
              onChange={(value) => set("buying", value)}
              options={[
                { value: "ALL", label: "Tout" },
                { value: "AUCTION", label: "Enchères" },
                { value: "FIXED_PRICE", label: "Achat immédiat" },
              ]}
            />
          </div>

          {form.buying !== "FIXED_PRICE" && (
            <label className="field">
              <span>Alerte de fin d'enchère</span>
              <div className="input-suffix">
                <input
                  inputMode="numeric"
                  value={form.endingWindowMin}
                  onChange={(event) => set("endingWindowMin", event.target.value.replace(/\D/g, ""))}
                  disabled={input.maxPrice === null}
                />
                <span>min avant la fin</span>
              </div>
              <small>
                {input.maxPrice === null
                  ? "Définis un prix max pour l'activer."
                  : "Une enchère encore sous ton prix max à ce moment-là te sera signalée."}
              </small>
            </label>
          )}
        </section>

        <section className="panel">
          <div className="field">
            <span>Sites eBay interrogés</span>
            <div className="toggle-chips">
              {status.data.marketplaces.map((marketplace) => {
                const on = form.marketplaces.includes(marketplace);
                return (
                  <button
                    key={marketplace}
                    type="button"
                    aria-pressed={on}
                    className={on ? "active" : ""}
                    onClick={() =>
                      set("marketplaces", on ? form.marketplaces.filter((m) => m !== marketplace) : [...form.marketplaces, marketplace])
                    }
                  >
                    {MARKETPLACE_LABEL[marketplace] ?? marketplace}
                  </button>
                );
              })}
            </div>
            <small>eBay US suffit en général : les vendeurs du monde entier, notamment chinois, y sont visibles. Chaque site ajouté coûte du quota.</small>
          </div>

          <label className="field">
            <span>Pays du vendeur</span>
            <select value={form.country} onChange={(event) => set("country", event.target.value)}>
              <option value="">Tous les pays</option>
              {SELLER_COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Mots à exclure</span>
            <ChipsInput value={form.excludes} onChange={(value) => set("excludes", value)} placeholder="reprint, custom…" />
            <small>Une annonce dont le titre contient un de ces mots est ignorée.</small>
          </div>
        </section>

        <section className="panel">
          <h2>Filtres</h2>

          <div className="field">
            <span>Mots obligatoires</span>
            <ChipsInput value={form.requiredWords} onChange={(value) => set("requiredWords", value)} placeholder="auto, /99…" />
            <small>Le titre doit contenir chacun de ces mots.</small>
          </div>

          <div className="field">
            <span>État de la carte</span>
            <Segmented
              label="État de la carte"
              value={form.grading}
              onChange={(value) => set("grading", value)}
              options={[
                { value: "ANY", label: "Toutes" },
                { value: "GRADED", label: "Gradées" },
                { value: "RAW", label: "Non gradées" },
              ]}
            />
            <small>Gradée : PSA, BGS, SGC, CGC… dans le titre, ou état « Graded » sur eBay.</small>
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={form.excludeLots} onChange={(event) => set("excludeLots", event.target.checked)} />
            <span>
              Exclure les lots
              <small>Titres avec « lot », « bundle », « 10 cards »…</small>
            </span>
          </label>

          <div className="field">
            <span>Vendeur fiable</span>
            <div className="field-row">
              <div className="input-suffix">
                <input
                  inputMode="decimal"
                  value={form.minSellerFeedbackPct}
                  onChange={(event) => set("minSellerFeedbackPct", event.target.value.replace(/[^\d.,]/g, ""))}
                  placeholder="98"
                  aria-label="Avis positifs minimum"
                />
                <span>% d'avis positifs min.</span>
              </div>
              <div className="input-suffix">
                <input
                  inputMode="numeric"
                  value={form.minSellerFeedbackScore}
                  onChange={(event) => set("minSellerFeedbackScore", event.target.value.replace(/\D/g, ""))}
                  placeholder="50"
                  aria-label="Évaluations minimum"
                />
                <span>évaluations min.</span>
              </div>
            </div>
            <small>Laisse vide pour ne pas filtrer.</small>
          </div>
        </section>

        <div className="editor-actions">
          <p className="muted small">
            ≈ {calls} appel{calls > 1 ? "s" : ""} eBay par vérification
          </p>
          <button
            type="button"
            className="button"
            disabled={!valid || preview.isPending}
            onClick={() => preview.mutate(input)}
          >
            {preview.isPending ? "Recherche…" : "Aperçu des annonces"}
          </button>
          <button className="button primary" disabled={!valid || save.isPending}>
            {searchId === null ? "Créer et surveiller" : "Enregistrer"}
          </button>
        </div>

        {existing && (
          <div className="secondary-actions">
            <button type="button" className="button small" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? "Vérification…" : "Vérifier maintenant"}
            </button>
            <button type="button" className="button small" onClick={() => toggle.mutate()}>
              {existing.active ? "Mettre en pause" : "Réactiver"}
            </button>
            <button
              type="button"
              className="button small danger"
              onClick={() => window.confirm(`Supprimer « ${existing.query} » ?`) && remove.mutate()}
            >
              Supprimer
            </button>
          </div>
        )}
      </form>

      {preview.data && (
        <section className="preview">
          <h2>
            {preview.data.length === 0
              ? "Aucune annonce ne correspond en ce moment"
              : `${preview.data.length} annonce${preview.data.length > 1 ? "s" : ""} en ligne correspond${preview.data.length > 1 ? "ent" : ""}`}
          </h2>
          <p className="muted small">
            Ces annonces existent déjà : elles ne déclencheront pas d'alerte. Tu seras prévenu pour les suivantes
            {watchesEnding ? ", et pour les enchères qui se terminent sous ton prix max." : "."}
          </p>
          <div className="listing-grid">
            {preview.data.map(({ listing, totalHome, importCost }) => (
              <ListingCard
                key={listing.itemKey}
                title={listing.title}
                url={listing.url}
                imageUrl={listing.imageUrl}
                {...priceParts(listing, totalHome, importCost, home)}
                endAt={listing.buyingOptions.includes("AUCTION") ? listing.endAt : null}
                meta={[
                  listing.buyingOptions.includes("AUCTION") ? `🔨 ${listing.bidCount ?? 0} offre${(listing.bidCount ?? 0) > 1 ? "s" : ""}` : "🛒 Achat immédiat",
                  sellerMeta(listing.seller, listing.country),
                ]}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
