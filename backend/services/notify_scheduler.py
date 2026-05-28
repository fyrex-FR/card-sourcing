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

from services.discord_service import build_ending_auction_embed, send_discord_message
from services.supabase_rest import request

NOTIFY_STATUSES = ("bid_planned", "in_basket", "watching")
DEFAULT_PRIMARY_MIN = 30
CHECK_INTERVAL_SECONDS = 300  # 5 min
MAX_WINDOW_MIN = 240


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


async def run_scheduler() -> None:
    interval = int(os.getenv("NOTIFY_CHECK_INTERVAL_SECONDS", str(CHECK_INTERVAL_SECONDS)))
    while True:
        try:
            stats = await check_and_notify_once()
            if stats["sent"] or stats["failed"]:
                print(f"[notify] tick : sent={stats['sent']} failed={stats['failed']}")
        except Exception as exc:
            print(f"[notify] tick crashed : {exc}")
        await asyncio.sleep(interval)
