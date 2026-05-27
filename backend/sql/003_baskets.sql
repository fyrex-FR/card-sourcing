-- 003_baskets.sql
-- Lot suivant : workflow panier vendeur (optimisation frais de port)
--   * statut in_basket = "je veux acheter cette carte si je groupe avec d'autres
--     du meme vendeur"
--   * shipping_estimate par favori vendeur, pour calculer l'economie de port

alter table public.sourcing_items
    drop constraint if exists sourcing_items_status_check;

alter table public.sourcing_items
    add constraint sourcing_items_status_check
    check (status in ('new', 'watching', 'in_basket', 'bid_planned', 'ignored', 'bought', 'too_expensive'));

alter table public.sourcing_seller_favorites
    add column if not exists shipping_estimate numeric;
