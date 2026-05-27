-- 002_workflow.sql
-- Lot 2 : workflow achat persistant
--   * note privee + montant max d'enchere par item
--   * statut bid_planned (a encherir)
--   * favoris vendeurs persistes en base (au lieu de localStorage)

alter table public.sourcing_items
    add column if not exists max_bid numeric,
    add column if not exists note text;

-- Le check constraint ne supporte pas IF NOT EXISTS, donc drop/create
alter table public.sourcing_items
    drop constraint if exists sourcing_items_status_check;

alter table public.sourcing_items
    add constraint sourcing_items_status_check
    check (status in ('new', 'watching', 'bid_planned', 'ignored', 'bought', 'too_expensive'));

create table if not exists public.sourcing_seller_favorites (
    user_id uuid not null,
    seller_username text not null,
    note text,
    created_at timestamptz not null default now(),
    primary key (user_id, seller_username)
);

alter table public.sourcing_seller_favorites enable row level security;

drop policy if exists sourcing_seller_favorites_owner on public.sourcing_seller_favorites;
create policy sourcing_seller_favorites_owner
    on public.sourcing_seller_favorites
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create index if not exists sourcing_seller_favorites_user_idx
    on public.sourcing_seller_favorites(user_id, created_at desc);
