-- 006_shared_data.sql
-- Mode "team partage" (Option A) : tous les utilisateurs authentifies voient
-- et editent les memes watchlists, items et favoris vendeurs. Chaque user
-- garde uniquement ses settings perso (webhook Discord, preferences notif).

-- === RLS : ouvert a tout user authentifie ===
drop policy if exists sourcing_watchlists_owner on public.sourcing_watchlists;
create policy sourcing_watchlists_shared on public.sourcing_watchlists
    for all
    using (auth.uid() is not null)
    with check (auth.uid() is not null);

drop policy if exists sourcing_items_owner on public.sourcing_items;
create policy sourcing_items_shared on public.sourcing_items
    for all
    using (auth.uid() is not null)
    with check (auth.uid() is not null);

drop policy if exists sourcing_seller_favorites_owner on public.sourcing_seller_favorites;
create policy sourcing_seller_favorites_shared on public.sourcing_seller_favorites
    for all
    using (auth.uid() is not null)
    with check (auth.uid() is not null);

-- sourcing_user_settings reste owner-only (webhook personnel)

-- === Cles uniques : retirer user_id des cles de dedup partagees ===

-- Items : dedup partage par (watchlist_id, source, external_id) au lieu de
-- (user_id, watchlist_id, source, external_id). On supprime les doublons
-- existants avant d'ajouter la nouvelle contrainte.
alter table public.sourcing_items
    drop constraint if exists sourcing_items_user_id_watchlist_id_source_external_id_key;

delete from public.sourcing_items a
    using public.sourcing_items b
    where a.id < b.id
      and a.watchlist_id = b.watchlist_id
      and a.source = b.source
      and a.external_id is not null
      and a.external_id = b.external_id;

alter table public.sourcing_items
    add constraint sourcing_items_shared_dedup_key
    unique (watchlist_id, source, external_id);

-- Seller favorites : un favori est partage par toute l'equipe. On passe la
-- PK de (user_id, seller_username) a seller_username seul.
delete from public.sourcing_seller_favorites a
    using public.sourcing_seller_favorites b
    where a.ctid < b.ctid
      and a.seller_username = b.seller_username;

alter table public.sourcing_seller_favorites
    drop constraint if exists sourcing_seller_favorites_pkey;

alter table public.sourcing_seller_favorites
    add primary key (seller_username);

-- === Tracking notifications : per-user-per-item ===
-- En mode partage, un meme item engendre une notif distincte pour chaque
-- user qui a configure son webhook. On track per-user pour ne pas
-- re-notifier le meme user deux fois.
create table if not exists public.sourcing_item_notifications (
    item_id uuid not null,
    user_id uuid not null,
    notified_primary_at timestamptz,
    notified_secondary_at timestamptz,
    primary key (item_id, user_id)
);

alter table public.sourcing_item_notifications enable row level security;

drop policy if exists sourcing_item_notifications_owner on public.sourcing_item_notifications;
create policy sourcing_item_notifications_owner on public.sourcing_item_notifications
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create index if not exists sourcing_item_notifications_user_idx
    on public.sourcing_item_notifications(user_id);
