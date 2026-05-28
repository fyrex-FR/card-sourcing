"""
Scheduler de notifications en mode "team partage" (option A + webhook commun).

Une seule config (sourcing_team_settings, ligne singleton) avec UN webhook
Discord. Tous les items de l'equipe deviennent eligibles selon les statuts
opt-in. Une seule notif par item, marquee au niveau item (notified_ending_at
pour la primaire, notified_secondary_at pour la secondaire).

Pas de doublons meme si plusieurs users sont connectes : le scheduler ne
voit qu'un seul webhook.
"""

import asyncio
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from services.discord_service import (
    build_daily_summary_embed,
    build_ending_auction_embed,
    build_max_bid_exceeded_embed,
    send_discord_message,
)
from services.ebay_service import get_item_current_price
from services.supabase_rest import request

NOTIFY_STATUSES = ("bid_planned", "in_basket", "watching")
DEFAULT_PRIMARY_MIN = 30
CHECK_INTERVAL_SECONDS = 300  # 5 min
MAX_WINDOW_MIN = 240
# Re-fetch eBay seulement pour les items qui finissent dans cette fenetre
# (au-dela le prix bouge peu, on economise les appels API)
MAX_BID_CHECK_WINDOW_MIN = 60 * 24  # 24h

TZ_PARIS = ZoneInfo("Europe/Paris")


async def _get_team_settings() -> dict[str, Any] | None:
    rows = await request(
        "GET",
        "sourcing_team_settings",
        params={"id": "eq.true", "limit": "1"},
    )
    if rows:
        return rows[0]
    return None


def _status_enabled(setting: dict[str, Any], status: str) -> bool:
    flag_map = {
        "bid_planned": "notify_bid_planned",
        "in_basket": "notify_in_basket",
        "watching": "notify_watching",
    }
    flag = flag_map.get(status)
    if flag is None:
        return False
    value = setting.get(flag)
    if value is None:
        return status == "bid_planned"
    return bool(value)


async def _list_pending_items() -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=MAX_WINDOW_MIN)
    or_clause = ",".join(f"status.eq.{s}" for s in NOTIFY_STATUSES)
    params = {
        "auction_end_at": f"gte.{now.isoformat()}",
        "and": f"(auction_end_at.lte.{until.isoformat()})",
        "or": f"({or_clause})",
        "limit": "500",
    }
    rows = await request("GET", "sourcing_items", params=params)
    return rows or []


def _resolve_thresholds(item: dict[str, Any], setting: dict[str, Any]) -> tuple[int | None, int | None]:
    item_primary = item.get("notify_minutes_before")
    primary = int(item_primary) if item_primary is not None else int(setting.get("notify_minutes_before") or DEFAULT_PRIMARY_MIN)
    item_secondary = item.get("notify_minutes_before_secondary")
    if item_secondary is not None:
        secondary: int | None = int(item_secondary)
    else:
        raw = setting.get("notify_minutes_before_secondary")
        secondary = int(raw) if raw is not None else None
    return primary, secondary


def _color_for_minutes_left(minutes: int) -> int:
    if minutes <= 10:
        return 0xE65A5A
    if minutes <= 30:
        return 0xE89F4A
    if minutes <= 60:
        return 0xF4D182
    return 0x5A73C7


async def _mark_item_notified(item_id: str, column: str, value: str) -> None:
    try:
        await request(
            "PATCH",
            "sourcing_items",
            params={"id": f"eq.{item_id}"},
            json={column: value},
        )
    except Exception as exc:  # pragma: no cover
        print(f"[notify] _mark_item_notified failed for item {item_id} ({column}): {exc}")


async def _send_grouped(
    webhook: str,
    notifications: list[tuple[dict[str, Any], int, bool]],
    mention_here_flag: bool,
) -> bool:
    if not notifications:
        return True
    by_seller: dict[str, list[tuple[dict[str, Any], int, bool]]] = defaultdict(list)
    for tup in notifications:
        seller = tup[0].get("seller_username") or "vendeur-inconnu"
        by_seller[seller].append(tup)

    all_ok = True
    for seller, group in by_seller.items():
        embeds = []
        any_critical = False
        for item, minutes_left, is_secondary in group:
            embed = build_ending_auction_embed(item)
            embed["color"] = _color_for_minutes_left(minutes_left)
            if is_secondary:
                embed["title"] = "[RAPPEL] " + (embed.get("title") or "")
            if minutes_left <= 10:
                any_critical = True
            embeds.append(embed)

        content = None
        if mention_here_flag and any_critical:
            content = f"@here {len(group)} carte{'s' if len(group) > 1 else ''} chez {seller} terminent bientot"

        for chunk_start in range(0, len(embeds), 10):
            chunk = embeds[chunk_start:chunk_start + 10]
            ok, message = await send_discord_message(
                webhook,
                content=content if chunk_start == 0 else None,
                embeds=chunk,
            )
            if not ok:
                print(f"[notify] send failed for seller {seller}: {message}")
                all_ok = False
    return all_ok


async def check_and_notify_once() -> dict[str, int]:
    setting = await _get_team_settings()
    if not setting:
        return {"sent": 0, "failed": 0}
    webhook = setting.get("discord_webhook_url")
    if not webhook:
        return {"sent": 0, "failed": 0}

    items = await _list_pending_items()
    if not items:
        return {"sent": 0, "failed": 0}

    now = datetime.now(timezone.utc)
    mention_here = bool(setting.get("discord_mention_here"))

    primary_to_send: list[tuple[dict[str, Any], int, bool]] = []
    secondary_to_send: list[tuple[dict[str, Any], int, bool]] = []

    for item in items:
        override = item.get("notify_enabled")
        if override is False:
            continue
        if override is None:
            if not _status_enabled(setting, item.get("status") or ""):
                continue
        end_iso = item.get("auction_end_at")
        if not end_iso:
            continue
        try:
            end_at = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        except ValueError:
            continue
        minutes_left = int((end_at - now).total_seconds() / 60)
        if minutes_left <= 0:
            continue

        primary_min, secondary_min = _resolve_thresholds(item, setting)

        # Secondaire (urgent) prioritaire pour eviter la course
        if (
            secondary_min is not None
            and minutes_left <= secondary_min
            and not item.get("notified_secondary_at")
        ):
            secondary_to_send.append((item, minutes_left, True))
            continue

        if minutes_left <= primary_min and not item.get("notified_ending_at"):
            primary_to_send.append((item, minutes_left, False))

    all_to_send = primary_to_send + secondary_to_send
    if not all_to_send:
        return {"sent": 0, "failed": 0}

    ok = await _send_grouped(webhook, all_to_send, mention_here)
    sent = 0
    failed = 0
    if ok:
        for item, _minutes, is_secondary in all_to_send:
            column = "notified_secondary_at" if is_secondary else "notified_ending_at"
            await _mark_item_notified(item["id"], column, item.get("auction_end_at") or now.isoformat())
        sent = len(all_to_send)
    else:
        failed = len(all_to_send)
    return {"sent": sent, "failed": failed}


async def _list_bid_planned_with_max() -> list[dict[str, Any]]:
    """Items bid_planned avec max_bid defini, fin dans la fenetre, non encore alerte."""
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=MAX_BID_CHECK_WINDOW_MIN)
    params = {
        "status": "eq.bid_planned",
        "max_bid": "not.is.null",
        "auction_end_at": f"gte.{now.isoformat()}",
        "and": f"(auction_end_at.lte.{until.isoformat()})",
        "notified_max_bid_exceeded_at": "is.null",
        "limit": "100",
    }
    rows = await request("GET", "sourcing_items", params=params)
    return rows or []


async def check_max_bid_exceeded(setting: dict[str, Any]) -> dict[str, int]:
    """
    Pour chaque item bid_planned avec max_bid defini, refetch le prix actuel
    sur eBay. Si le prix depasse max_bid, envoie une alerte Discord et marque
    l'item pour eviter de re-spammer.

    QUOTA EBAY : 1 appel par item bid_planned dans la fenetre 24h, a chaque
    tick (5 min). Browse API = 5000 appels/jour par defaut. Au-dela de ~17
    items en parallele, on risque de saturer. Voir get_item_current_price
    dans ebay_service.py pour le detail et les leviers d'ajustement.
    """
    if not setting.get("notify_max_bid_exceeded", True):
        return {"sent": 0, "failed": 0}
    webhook = setting.get("discord_webhook_url")
    if not webhook:
        return {"sent": 0, "failed": 0}

    items = await _list_bid_planned_with_max()
    if not items:
        return {"sent": 0, "failed": 0}

    sent = 0
    failed = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for item in items:
        external_id = item.get("external_id")
        if not external_id:
            continue
        max_bid = item.get("max_bid")
        if max_bid is None:
            continue
        live = await get_item_current_price(external_id)
        if not live:
            # Item peut-etre supprime ou erreur API, on n'alerte pas
            continue
        current_price = live.get("price")
        if current_price is None or current_price <= float(max_bid):
            continue

        embed = build_max_bid_exceeded_embed(item, current_price)
        ok, message = await send_discord_message(webhook, embeds=[embed])
        if ok:
            await _mark_item_notified(item["id"], "notified_max_bid_exceeded_at", now_iso)
            sent += 1
        else:
            print(f"[notify] max_bid send failed for {item.get('id')}: {message}")
            failed += 1

    return {"sent": sent, "failed": failed}


def _local_today_anchor(setting: dict[str, Any], now_utc: datetime) -> datetime:
    """Renvoie le datetime UTC correspondant a HHh00 Europe/Paris pour aujourd'hui."""
    now_local = now_utc.astimezone(TZ_PARIS)
    target_hour = int(setting.get("daily_summary_hour") or 9)
    target_local = now_local.replace(hour=target_hour, minute=0, second=0, microsecond=0)
    return target_local.astimezone(timezone.utc)


async def _build_daily_summary_stats() -> dict[str, Any]:
    """Compile les stats des paniers actifs pour le resume."""
    now = datetime.now(timezone.utc)
    or_clause = ",".join(f"status.eq.{s}" for s in ("bid_planned", "in_basket"))
    items = await request(
        "GET",
        "sourcing_items",
        params={
            "or": f"({or_clause})",
            "limit": "500",
        },
    ) or []

    # Charge les frais de port estimes
    favorites = await request(
        "GET",
        "sourcing_seller_favorites",
        params={"limit": "500"},
    ) or []
    shipping_by_seller = {f["seller_username"]: f.get("shipping_estimate") for f in favorites}
    DEFAULT_SHIPPING = 12.0

    by_seller: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        seller = item.get("seller_username")
        if not seller:
            continue
        by_seller[seller].append(item)

    baskets = []
    total_potential = 0.0
    total_savings = 0.0
    currency = "USD"
    next_ending = None
    for seller, group in by_seller.items():
        cards_total = sum(float(item.get("price") or 0) for item in group)
        ship_per_item = sum(float(item.get("shipping_price") or 0) for item in group)
        ship_estimate = shipping_by_seller.get(seller)
        ship_grouped = float(ship_estimate) if ship_estimate is not None else DEFAULT_SHIPPING
        total_grouped = cards_total + ship_grouped
        total_separate = cards_total + ship_per_item
        savings = max(0.0, total_separate - total_grouped)
        total_potential += total_grouped
        total_savings += savings
        if group:
            currency = group[0].get("currency") or currency
        baskets.append({
            "seller": seller,
            "count": len(group),
            "total": total_grouped,
            "savings": savings,
            "currency": group[0].get("currency") if group else currency,
        })
        # Prochaine fin
        for item in group:
            end_iso = item.get("auction_end_at")
            if not end_iso:
                continue
            try:
                end_at = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
            except ValueError:
                continue
            if end_at <= now:
                continue
            if next_ending is None:
                next_ending = item
            else:
                try:
                    cur_end = datetime.fromisoformat((next_ending.get("auction_end_at") or "").replace("Z", "+00:00"))
                    if end_at < cur_end:
                        next_ending = item
                except ValueError:
                    pass

    baskets.sort(key=lambda b: b["total"], reverse=True)
    planned_count = sum(1 for item in items if item.get("status") == "bid_planned")

    return {
        "baskets_count": len(baskets),
        "items_count": len(items),
        "planned_count": planned_count,
        "total_potential": total_potential,
        "total_savings": total_savings,
        "currency": currency,
        "next_ending": next_ending,
        "top_baskets": baskets[:5],
    }


async def maybe_send_daily_summary(setting: dict[str, Any]) -> bool:
    """
    Envoie le resume si l'heure cible (Europe/Paris) est passee aujourd'hui
    et qu'on n'a pas encore envoye le resume du jour. Renvoie True si envoye.
    """
    if not setting.get("daily_summary_enabled"):
        return False
    webhook = setting.get("discord_webhook_url")
    if not webhook:
        return False

    now_utc = datetime.now(timezone.utc)
    target_utc = _local_today_anchor(setting, now_utc)
    if now_utc < target_utc:
        return False  # Pas encore l'heure

    last_iso = setting.get("last_daily_summary_at")
    if last_iso:
        try:
            last_at = datetime.fromisoformat(last_iso.replace("Z", "+00:00"))
        except ValueError:
            last_at = None
        if last_at and last_at >= target_utc:
            return False  # Deja envoye aujourd'hui

    stats = await _build_daily_summary_stats()
    embed = build_daily_summary_embed(stats)
    ok, message = await send_discord_message(webhook, embeds=[embed])
    if not ok:
        print(f"[notify] daily summary failed: {message}")
        return False

    # Mark sent
    try:
        await request(
            "PATCH",
            "sourcing_team_settings",
            params={"id": "eq.true"},
            json={"last_daily_summary_at": now_utc.isoformat()},
        )
    except Exception as exc:  # pragma: no cover
        print(f"[notify] mark daily_summary_at failed: {exc}")
    return True


async def run_scheduler() -> None:
    interval = int(os.getenv("NOTIFY_CHECK_INTERVAL_SECONDS", str(CHECK_INTERVAL_SECONDS)))
    while True:
        try:
            stats = await check_and_notify_once()
            if stats["sent"] or stats["failed"]:
                print(f"[notify] ending tick : sent={stats['sent']} failed={stats['failed']}")
            # Recharge les settings pour les checks suivants
            setting = await _get_team_settings()
            if setting:
                bid_stats = await check_max_bid_exceeded(setting)
                if bid_stats["sent"] or bid_stats["failed"]:
                    print(f"[notify] max_bid tick : sent={bid_stats['sent']} failed={bid_stats['failed']}")
                summary_sent = await maybe_send_daily_summary(setting)
                if summary_sent:
                    print("[notify] daily summary sent")
        except Exception as exc:
            print(f"[notify] tick crashed : {exc}")
        await asyncio.sleep(interval)
