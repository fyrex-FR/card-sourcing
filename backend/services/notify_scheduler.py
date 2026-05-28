"""
Scheduler de notifications : tourne en tache de fond, scrute les items
'bid_planned' / 'in_basket' / 'watching' qui finissent bientot et n'ont pas
encore ete notifies, puis envoie un embed Discord au webhook utilisateur.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from services.discord_service import build_ending_auction_embed, send_discord_message
from services.supabase_rest import request

# Statuts qui declenchent une notif de fin d'enchere
NOTIFY_STATUSES = ("bid_planned", "in_basket", "watching")
# Fenetre par defaut (l'utilisateur peut surcharger via notify_minutes_before)
DEFAULT_NOTIFY_WINDOW_MIN = 30
# Periode de polling
CHECK_INTERVAL_SECONDS = 300  # 5 min


async def _list_user_settings_with_webhook() -> list[dict[str, Any]]:
    rows = await request(
        "GET",
        "sourcing_user_settings",
        params={"discord_webhook_url": "not.is.null"},
    )
    return rows or []


async def _list_pending_items(user_id: str, window_minutes: int) -> list[dict[str, Any]]:
    """Items qui finissent dans la fenetre et n'ont pas encore ete notifies."""
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=window_minutes)
    or_clause = ",".join(f"status.eq.{status}" for status in NOTIFY_STATUSES)
    params = {
        "user_id": f"eq.{user_id}",
        "auction_end_at": f"gte.{now.isoformat()}",
        "and": f"(auction_end_at.lte.{until.isoformat()})",
        "or": f"({or_clause})",
        "notified_ending_at": "is.null",
        "limit": "50",
    }
    rows = await request("GET", "sourcing_items", params=params)
    return rows or []


async def _mark_notified(item_id: str, user_id: str, end_at: str) -> None:
    try:
        await request(
            "PATCH",
            "sourcing_items",
            params={"id": f"eq.{item_id}", "user_id": f"eq.{user_id}"},
            json={"notified_ending_at": end_at},
        )
    except Exception:  # pragma: no cover
        # Si la colonne n'existe pas (migration pas appliquee), on log et on
        # continue, l'item sera re-notifie au prochain tour - pas grave.
        pass


async def check_and_notify_once() -> dict[str, int]:
    """Un tour de scrutation. Renvoie un compteur pour le log."""
    sent = 0
    failed = 0
    settings = await _list_user_settings_with_webhook()
    for setting in settings:
        webhook = setting.get("discord_webhook_url")
        if not webhook:
            continue
        user_id = setting["user_id"]
        window = int(setting.get("notify_minutes_before") or DEFAULT_NOTIFY_WINDOW_MIN)
        try:
            items = await _list_pending_items(user_id, window)
        except Exception as exc:
            print(f"[notify] list_pending_items failed for user {user_id}: {exc}")
            failed += 1
            continue
        for item in items:
            embed = build_ending_auction_embed(item)
            ok, message = await send_discord_message(webhook, embeds=[embed])
            if ok:
                sent += 1
                await _mark_notified(item["id"], user_id, item.get("auction_end_at") or datetime.now(timezone.utc).isoformat())
            else:
                failed += 1
                print(f"[notify] send failed for item {item.get('id')}: {message}")
    return {"sent": sent, "failed": failed}


async def run_scheduler() -> None:
    """Boucle infinie a lancer au demarrage de l'app."""
    interval = int(os.getenv("NOTIFY_CHECK_INTERVAL_SECONDS", str(CHECK_INTERVAL_SECONDS)))
    while True:
        try:
            stats = await check_and_notify_once()
            if stats["sent"] or stats["failed"]:
                print(f"[notify] tick : sent={stats['sent']} failed={stats['failed']}")
        except Exception as exc:  # pragma: no cover
            print(f"[notify] tick crashed : {exc}")
        await asyncio.sleep(interval)
