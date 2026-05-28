-- 005_notification_params.sql
-- Notifications parametrables : par statut (compte global), par carte
-- (override), et 2eme alerte optionnelle pour les fins critiques.

-- === Reglages compte ===
alter table public.sourcing_user_settings
    add column if not exists notify_bid_planned boolean not null default true,
    add column if not exists notify_in_basket boolean not null default false,
    add column if not exists notify_watching boolean not null default false,
    add column if not exists notify_minutes_before_secondary integer,
    add column if not exists discord_mention_here boolean not null default false,
    add column if not exists discord_mention_at_minutes integer not null default 10;

-- === Override par item ===
-- notify_enabled : null = utilise le defaut du statut, true = force on, false = force off
-- notify_minutes_before : null = utilise le reglage compte
-- notify_minutes_before_secondary : null = utilise le reglage compte (si defini)
alter table public.sourcing_items
    add column if not exists notify_enabled boolean,
    add column if not exists notify_minutes_before integer,
    add column if not exists notify_minutes_before_secondary integer,
    add column if not exists notified_secondary_at timestamptz;
