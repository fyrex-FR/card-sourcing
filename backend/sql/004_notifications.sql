-- 004_notifications.sql
-- Notifications Discord pour les fins d'enchere des items bid_planned/in_basket/watching.

create table if not exists public.sourcing_user_settings (
    user_id uuid primary key,
    discord_webhook_url text,
    notify_minutes_before integer not null default 30,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.sourcing_user_settings enable row level security;

drop policy if exists sourcing_user_settings_owner on public.sourcing_user_settings;
create policy sourcing_user_settings_owner
    on public.sourcing_user_settings
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Marqueur pour eviter de re-notifier le meme item plusieurs fois.
-- On stocke quand on a notifie pour la fin d'enchere de cet item.
alter table public.sourcing_items
    add column if not exists notified_ending_at timestamptz;
