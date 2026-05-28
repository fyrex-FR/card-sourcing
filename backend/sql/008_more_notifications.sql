-- 008_more_notifications.sql
-- Resume quotidien + alerte depassement max_bid

alter table public.sourcing_team_settings
    add column if not exists daily_summary_enabled boolean not null default false,
    add column if not exists daily_summary_hour integer not null default 9,
    add column if not exists notify_max_bid_exceeded boolean not null default true,
    add column if not exists last_daily_summary_at timestamptz;

-- Marqueur item-level pour ne pas spammer l'alerte max_bid
alter table public.sourcing_items
    add column if not exists notified_max_bid_exceeded_at timestamptz;
