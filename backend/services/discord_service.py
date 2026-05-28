"""
Service de notification Discord via webhook.

Aucun bot a heberger : on poste directement sur l'URL webhook fournie par
l'utilisateur (cree dans son serveur Discord perso). Le webhook accepte un
JSON avec un message simple ou un embed riche.
"""

from datetime import datetime, timezone
from typing import Any

import httpx


def _format_time_left(end_iso: str | None) -> str:
    if not end_iso:
        return ""
    try:
        end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    except ValueError:
        return ""
    diff = end - datetime.now(timezone.utc)
    total_minutes = int(diff.total_seconds() / 60)
    if total_minutes <= 0:
        return "terminee"
    if total_minutes < 60:
        return f"{total_minutes} min"
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours}h {minutes:02d}"


def build_ending_auction_embed(item: dict[str, Any], current_price: float | None = None) -> dict[str, Any]:
    """Construit l'embed Discord pour une fin d'enchere imminente."""
    title = item.get("title") or "(sans titre)"
    if len(title) > 200:
        title = title[:197] + "..."

    price = current_price if current_price is not None else item.get("price")
    currency = item.get("currency") or "USD"
    max_bid = item.get("max_bid")
    seller = item.get("seller_username") or "?"
    url = item.get("url") or ""
    image = item.get("image_url")
    time_left = _format_time_left(item.get("auction_end_at"))
    status = item.get("status") or "new"

    fields = []
    if price is not None:
        fields.append({"name": "Prix actuel", "value": f"{price:.2f} {currency}", "inline": True})
    if max_bid is not None:
        fields.append({"name": "Ton max", "value": f"{max_bid:.2f} {currency}", "inline": True})
    if time_left:
        fields.append({"name": "Fin", "value": time_left, "inline": True})
    fields.append({"name": "Vendeur", "value": seller, "inline": True})
    fields.append({"name": "Statut", "value": status, "inline": True})

    color_map = {
        "bid_planned": 0x5A73C7,  # bleu
        "in_basket": 0x7FD49A,    # vert
        "watching": 0xF4D182,     # jaune
    }
    color = color_map.get(status, 0x808080)

    embed = {
        "title": title,
        "url": url,
        "color": color,
        "fields": fields,
    }
    if image:
        embed["thumbnail"] = {"url": image}

    return embed


async def send_discord_message(
    webhook_url: str,
    *,
    content: str | None = None,
    embeds: list[dict[str, Any]] | None = None,
) -> tuple[bool, str]:
    """Envoie un message au webhook Discord. Renvoie (success, message)."""
    payload: dict[str, Any] = {}
    if content:
        payload["content"] = content
    if embeds:
        payload["embeds"] = embeds[:10]  # Discord limite a 10 embeds par message
    if not payload:
        return False, "empty_payload"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook_url, json=payload)
        if resp.status_code in (200, 204):
            return True, "ok"
        return False, f"discord_{resp.status_code}: {resp.text[:200]}"
    except httpx.TimeoutException:
        return False, "timeout"
    except Exception as exc:  # pragma: no cover
        return False, str(exc)


async def send_test_notification(webhook_url: str) -> tuple[bool, str]:
    """Envoie un message de test pour valider le webhook."""
    embed = {
        "title": "Card Sourcing - test",
        "description": "Si tu vois ce message, tes notifications Discord sont configurees. "
                       "Tu seras alerte avant la fin des encheres planifiees.",
        "color": 0xF4D182,
    }
    return await send_discord_message(webhook_url, embeds=[embed])
