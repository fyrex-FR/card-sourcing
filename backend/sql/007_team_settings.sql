-- 007_team_settings.sql
-- Si toute l'equipe partage le meme Discord, on bascule les reglages notif
-- en config d'equipe (singleton) au lieu d'avoir une ligne par user. Plus
-- de risque de double-notif si plusieurs users mettent le meme webhook.

create table if not exists public.sourcing_team_settings (
    id boolean primary key default true,
    discord_webhook_url text,
    notify_minutes_before integer not null default 30,
    notify_minutes_before_secondary integer,
    notify_bid_planned boolean not null default true,
    notify_in_basket boolean not null default false,
    notify_watching boolean not null default false,
    discord_mention_here boolean not null default false,
    discord_mention_at_minutes integer not null default 10,
    updated_at timestamptz not null default now(),
    constraint singleton_check check (id = true)
);

-- Initialise la ligne singleton
insert into public.sourcing_team_settings (id) values (true)
    on conflict (id) do nothing;

-- Migre le premier webhook existant (s'il y en a) depuis sourcing_user_settings
update public.sourcing_team_settings ts
set
    discord_webhook_url = us.discord_webhook_url,
    notify_minutes_before = coalesce(us.notify_minutes_before, ts.notify_minutes_before),
    notify_minutes_before_secondary = us.notify_minutes_before_secondary,
    notify_bid_planned = coalesce(us.notify_bid_planned, ts.notify_bid_planned),
    notify_in_basket = coalesce(us.notify_in_basket, ts.notify_in_basket),
    notify_watching = coalesce(us.notify_watching, ts.notify_watching),
    discord_mention_here = coalesce(us.discord_mention_here, ts.discord_mention_here),
    discord_mention_at_minutes = coalesce(us.discord_mention_at_minutes, ts.discord_mention_at_minutes),
    updated_at = now()
from (
    select * from public.sourcing_user_settings
    where discord_webhook_url is not null
    order by created_at asc
    limit 1
) us
where ts.id = true;

alter table public.sourcing_team_settings enable row level security;

drop policy if exists sourcing_team_settings_shared on public.sourcing_team_settings;
create policy sourcing_team_settings_shared on public.sourcing_team_settings
    for all
    using (auth.uid() is not null)
    with check (auth.uid() is not null);

-- La table sourcing_item_notifications (006) n'est plus necessaire en mode
-- equipe (tracking se fait au niveau item via notified_ending_at /
-- notified_secondary_at qui existent deja sur sourcing_items). On la laisse
-- en place au cas ou on rebascule plus tard, mais le scheduler ne l'utilise
-- plus.
