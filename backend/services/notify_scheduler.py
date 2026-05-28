"""
Scheduler de notifications avec parametrage fin :

  - Par STATUT (compte) : on notifie pour bid_planned / in_basket / watching
    selon les toggles de l'utilisateur dans sourcing_user_settings.

  - Par ITEM (override) : sourcing_items.notify_enabled peut forcer on/off
    pour une carte. Pareil pour notify_minutes_before(_secondary).

  - 2 ALERTES par item : une primaire (ex: 30 min avant) et une secondaire
    optionnelle (ex: 5 min avant) avec @here Discord si configure.

  - GROUPAGE par vendeur : si plusieurs cartes du meme vendeur tombent dans
    le meme tick, on envoie UN seul message Discord avec plusieurs embeds.
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


async def _list_user_settings_with_webhook() -> list[dict[str, Any]]:
    rows = await request(
        "GET",
        "sourcing_user_settings",
        params={"discord_webhook_url": "not.is.null"},
    )
    return rows or []


def _status_enabled(setting: dict[str, Any], status: str) -> bool:
    """L'utilisateur a-t-il active ce statut ?"""
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
        # Defaut : bid_planned ON, autres OFF
        return status == "bid_planned"
    return bool(value)


async def _list_pending_items(user_id: str) -> list[dict[str, Any]]:
    """Items du user au statut potentiellement notifiable et a venir."""
    now = datetime.now(timezone.utc)
    or_clause = ",".join(f"status.eq.{status}" for status in NOTIFY_STATUSES)
    params = {
        "user_id": f"eq.{user_id}",
        "auction_end_at": f"gte.{now.isoformat()}",
        "or": f"({or_clause})",
        "limit": "200",
    }
    rows = await request("GET", "sourcing_items", params=params)
    return rows or []


def _resolve_thresholds(item: dict[str, Any], setting: dict[str, Any]) -> tuple[int | None, int | None]:
    """Renvoie (primaire_min, secondaire_min) en respectant l'override item."""
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
        return 0xE65A5A  # rouge - critique
    if minutes <= 30:
        return 0xE89F4A  # orange
    if minutes <= 60:
        return 0xF4D182  # jaune
    return 0x5A73C7      # bleu


async def _mark_notified(item_id: str, user_id: str, column: str, value: str) -> None:
    try:
        await request(
            "PATCH",
            "sourcing_items",
            params={"id": f"eq.{item_id}", "user_id": f"eq.{user_id}"},
            json={column: value},
        )
    except Exception:  # pragma: no cover
        # Si la colonne n'existe pas (migration pas appliquee), on log et on
        # continue. Sera re-notifie au prochain tour.
        pass


async def _send_grouped(
    webhook: str,
    notifications: list[tuple[dict[str, Any], int, bool, str]],
    mention_here_flag: bool,
) -> bool:
    """
    Envoie un message Discord avec un ou plusieurs embeds, regroupes par
    vendeur. notifications est une liste de (item, minutes_left, is_secondary, end_at_iso).
    Renvoie True si tout est parti correctement.
    """
    if not notifications:
        return True
    # Groupe par vendeur
    by_seller: dict[str, list[tuple[dict[str, Any], int, bool, str]]] = defaultdict(list)
    for tup in notifications:
        seller = tup[0].get("seller_username") or "vendeur-inconnu"
        by_seller[seller].append(tup)

    all_ok = True
    for seller, group in by_seller.items():
        embeds = []
        any_critical = False
        for item, minutes_left, is_secondary, _ in group:
            embed = build_ending_auction_embed(item)
            embed["color"] = _color_for_minutes_left(minutes_left)
            if is_secondary:
                # Secondaire : marqueur rappel urgent
                embed["title"] = "[RAPPEL] " + embed.get("title", "")
            if minutes_left <= 10:
                any_critical = True
        # Re-construit la liste embeds (la boucle ci-dessus modifiait via reference)
        embeds = []
        for item, minutes_left, is_secondary, _ in group:
            embed = build_ending_auction_embed(item)
            embed["color"] = _color_for_minutes_left(minutes_left)
            if is_secondary:
                embed["title"] = "[RAPPEL] " + (embed.get("title") or "")
            embeds.append(embed)

        content = None
        if mention_here_flag and any_critical:
            content = f"@here {len(group)} carte{'s' if len(group) > 1 else ''} chez {seller} terminent bientot"

        # Discord limite 10 embeds par message, on chunk si besoin
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
    """Un tour de scrutation."""
    sent = 0
    failed = 0
    settings_rows = await _list_user_settings_with_webhook()
    now = datetime.now(timezone.utc)

    for setting in settings_rows:
        webhook = setting.get("discord_webhook_url")
        if not webhook:
            continue
        user_id = setting["user_id"]
        mention_here = bool(setting.get("discord_mention_here"))

        try:
            items = await _list_pending_items(user_id)
        except Exception as exc:
            print(f"[notify] list_pending_items failed for user {user_id}: {exc}")
            failed += 1
            continue

        # Construit la liste des notifications a envoyer pour ce user
        primary_to_send: list[tuple[dict[str, Any], int, bool, str]] = []
        secondary_to_send: list[tuple[dict[str, Any], int, bool, str]] = []

        for item in items:
            # Filtre activation (override item -> defaut statut)
            override = item.get("notify_enabled")
            if override is False:
                continue
            if override is None:
                if not _status_enabled(setting, item.get("status") or ""):
                    continue
            # Calcul minutes restantes
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

            # Alerte secondaire (urgent) - on la check avant la primaire pour
            # eviter d'envoyer la primaire alors qu'on est deja en zone secondaire.
            if (
                secondary_min is not None
                and minutes_left <= secondary_min
                and not item.get("notified_secondary_at")
            ):
                secondary_to_send.append((item, minutes_left, True, end_iso))
                continue

            # Alerte primaire
            if minutes_left <= primary_min and not item.get("notified_ending_at"):
                primary_to_send.append((item, minutes_left, False, end_iso))

        # Envoi grouped
        all_to_send = primary_to_send + secondary_to_send
        if all_to_send:
            ok = await _send_grouped(webhook, all_to_send, mention_here)
            if ok:
                # Marquer notified_*
                for item, _, is_secondary, end_iso in all_to_send:
                    column = "notified_secondary_at" if is_secondary else "notified_ending_at"
                    await _mark_notified(item["id"], user_id, column, end_iso)
                sent += len(all_to_send)
            else:
                failed += len(all_to_send)

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
