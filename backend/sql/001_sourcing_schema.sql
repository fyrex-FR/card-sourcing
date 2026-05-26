create table if not exists public.sourcing_watchlists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    name text not null,
    query text not null,
    max_price numeric,
    marketplace text not null default 'EBAY_US',
    country_filter text not null default 'CN',
    buying_option text not null default 'AUCTION' check (buying_option in ('ALL', 'AUCTION', 'FIXED_PRICE')),
    notes text,
    active boolean not null default true,
    last_scan_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.sourcing_watchlists
    add column if not exists buying_option text not null default 'AUCTION'
    check (buying_option in ('ALL', 'AUCTION', 'FIXED_PRICE'));

create table if not exists public.sourcing_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    watchlist_id uuid not null references public.sourcing_watchlists(id) on delete cascade,
    source text not null default 'ebay',
    external_id text,
    title text not null,
    price numeric not null,
    currency text not null default 'USD',
    shipping_price numeric,
    url text not null,
    image_url text,
    seller_username text,
    seller_feedback numeric,
    country text,
    condition text,
    buying_options jsonb,
    status text not null default 'new' check (status in ('new', 'watching', 'ignored', 'bought', 'too_expensive')),
    raw jsonb,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    unique (user_id, watchlist_id, source, external_id)
);

alter table public.sourcing_watchlists enable row level security;
alter table public.sourcing_items enable row level security;

drop policy if exists sourcing_watchlists_owner on public.sourcing_watchlists;
create policy sourcing_watchlists_owner
    on public.sourcing_watchlists
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists sourcing_items_owner on public.sourcing_items;
create policy sourcing_items_owner
    on public.sourcing_items
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create index if not exists sourcing_watchlists_user_idx on public.sourcing_watchlists(user_id, created_at desc);
create index if not exists sourcing_items_user_watchlist_idx on public.sourcing_items(user_id, watchlist_id, first_seen_at desc);
create index if not exists sourcing_items_status_idx on public.sourcing_items(user_id, status);
