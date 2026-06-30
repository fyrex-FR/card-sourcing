from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import quote_plus, urlencode

import httpx


BASE_URL = "https://www.clutchcollect.io/marketplace.data"
MARKETPLACE_URL = "https://www.clutchcollect.io/marketplace"


@dataclass
class ClutchDeal:
    source: str
    source_id: str
    sale_type: str
    title: str
    player: str
    team: str
    year: str
    manufacturer: str
    program: str
    set_name: str
    card_number: str
    serial_number: str
    sequence_number: str
    grade: str
    price: float | None
    currency: str
    seller: str
    ends_at: str
    total_bids: int | None
    image_url: str
    clutch_url: str
    comp_query: str
    ebay_sold_url: str
    one30point_url: str
    score: int
    reasons: list[str]


def _decode_remix_payload(payload: list[Any]) -> Any:
    @lru_cache(maxsize=None)
    def ref(index: int) -> Any:
        if index == -5:
            return None
        return hydrate(payload[index])

    def hydrate(value: Any) -> Any:
        if isinstance(value, dict):
            out: dict[Any, Any] = {}
            for key, raw in value.items():
                decoded_key = ref(int(key[1:])) if isinstance(key, str) and key.startswith("_") else key
                decoded_value = ref(raw) if isinstance(raw, int) and raw >= 0 else (None if raw == -5 else hydrate(raw))
                out[decoded_key] = decoded_value
            return out
        if isinstance(value, list):
            return [ref(item) if isinstance(item, int) and item >= 0 else (None if item == -5 else hydrate(item)) for item in value]
        return value

    return hydrate(payload[0])


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _price_for_sale(sale: dict[str, Any]) -> tuple[float | None, str, str, int | None]:
    if sale.get("type") == "auction":
        auction = sale.get("auction") or {}
        price = auction.get("currentPrice") or auction.get("startPrice")
        return _float(price), _text(auction.get("currency") or "EUR").upper(), _text(auction.get("endsAt")), _int(auction.get("totalBids"))
    listing = sale.get("listing") or {}
    price = listing.get("effectivePrice") or listing.get("discountPrice") or listing.get("price")
    return _float(price), _text(listing.get("currency") or "EUR").upper(), "", None


def _comp_query(collectible: dict[str, Any], owned: dict[str, Any]) -> str:
    set_data = collectible.get("collectibleSet") or {}
    card_number = _text(collectible.get("number"))
    serial_number = _text(owned.get("serialNumber"))
    sequence = _text(collectible.get("sequenceNumber"))
    parts = [
        _text(set_data.get("releaseYear")),
        _text(set_data.get("manufacturer")),
        _text(set_data.get("program")),
        _text(set_data.get("setName")),
        _text(collectible.get("player")),
        f"#{card_number}" if card_number else "",
    ]
    if sequence and sequence != "0":
        parts.append(f"/{sequence}")
    if serial_number and sequence and serial_number != "0" and sequence != "0":
        parts.append(f"{serial_number}/{sequence}")
    grade = _text(owned.get("gradingService"))
    grade_num = _text(owned.get("gradingGrade"))
    if grade and grade.lower() not in {"none", "null"}:
        parts.extend([grade, grade_num if grade_num.lower() != "null" else ""])
    return " ".join(part for part in parts if part)


def _title(collectible: dict[str, Any], owned: dict[str, Any]) -> str:
    set_data = collectible.get("collectibleSet") or {}
    parts = [
        _text(set_data.get("name")),
        _text(collectible.get("player")),
        _text(collectible.get("team")),
    ]
    serial = _text(owned.get("serialNumber"))
    sequence = _text(collectible.get("sequenceNumber"))
    if serial and sequence and serial != "0" and sequence != "0":
        parts.append(f"{serial}/{sequence}")
    grade = _text(owned.get("gradingService"))
    grade_num = _text(owned.get("gradingGrade"))
    if grade and grade.lower() not in {"none", "null"}:
        parts.append(f"{grade} {grade_num if grade_num.lower() != 'null' else ''}".strip())
    return " ".join(part for part in parts if part)


def _score(sale_type: str, price: float | None, collectible: dict[str, Any], owned: dict[str, Any], sale: dict[str, Any]) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    if sale_type == "auction":
        score += 20
        reasons.append("enchere")
    if price is not None:
        if price <= 10:
            score += 25
            reasons.append("prix <= 10")
        elif price <= 25:
            score += 15
            reasons.append("prix <= 25")
        elif price <= 50:
            score += 8
            reasons.append("prix <= 50")
    sequence = _int(collectible.get("sequenceNumber"))
    if sequence and sequence <= 25:
        score += 12
        reasons.append(f"numbered /{sequence}")
    props = owned.get("properties") or {}
    if props.get("isAutographed"):
        score += 10
        reasons.append("auto")
    if collectible.get("isRookie") or props.get("isRookie"):
        score += 8
        reasons.append("rookie")
    marker = sale.get("auction") if sale_type == "auction" else sale.get("listing")
    if (marker or {}).get("isGreatDeal"):
        score += 20
        reasons.append("flag great deal")
    return score, reasons


def _normalize_sale(sale: dict[str, Any]) -> ClutchDeal:
    sale_type = _text(sale.get("type"))
    owned = sale.get("ownedCollectible") or {}
    collectible = owned.get("collectible") or sale.get("collectible") or {}
    set_data = collectible.get("collectibleSet") or {}
    owner = sale.get("owner") or {}
    source_obj = (sale.get("auction") if sale_type == "auction" else sale.get("listing")) or {}
    source_id = source_obj.get("auctionId") or source_obj.get("id") or owned.get("id")
    price, currency, ends_at, total_bids = _price_for_sale(sale)
    comp_query = _comp_query(collectible, owned)
    score, reasons = _score(sale_type, price, collectible, owned, sale)
    ebay_params = urlencode({"_nkw": comp_query, "LH_Sold": "1", "LH_Complete": "1", "_sop": "13"})
    return ClutchDeal(
        source="clutchcollect",
        source_id=_text(source_id),
        sale_type=sale_type,
        title=_title(collectible, owned),
        player=_text(collectible.get("player")),
        team=_text(collectible.get("team")),
        year=_text(set_data.get("releaseYear")),
        manufacturer=_text(set_data.get("manufacturer")),
        program=_text(set_data.get("program")),
        set_name=_text(set_data.get("setName")),
        card_number=_text(collectible.get("number")),
        serial_number=_text(owned.get("serialNumber")),
        sequence_number=_text(collectible.get("sequenceNumber")),
        grade=" ".join(
            part
            for part in [_text(owned.get("gradingService")), _text(owned.get("gradingGrade"))]
            if part and part.lower() not in {"none", "null"}
        ),
        price=price,
        currency=currency,
        seller=_text(owner.get("username")),
        ends_at=ends_at,
        total_bids=total_bids,
        image_url=_text(owned.get("frontImageUrlMiniature") or owned.get("frontImageUrlStandard")),
        clutch_url=f"{MARKETPLACE_URL}?{urlencode({'q': comp_query})}" if comp_query else MARKETPLACE_URL,
        comp_query=comp_query,
        ebay_sold_url=f"https://www.ebay.com/sch/i.html?{ebay_params}",
        one30point_url=f"https://130point.com/sales/?search={quote_plus(comp_query)}",
        score=score,
        reasons=reasons,
    )


async def search_clutch_deals(
    *,
    query: str = "",
    sale_filter: str = "auctions",
    order: str = "ending_soon",
    sport: str | None = "9",
    pages: int = 2,
    limit: int = 24,
) -> dict[str, Any]:
    rows: list[ClutchDeal] = []
    last_stats: dict[str, Any] = {}
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "card-sourcing/0.1", "Accept": "application/json"}) as client:
        for page in range(1, max(1, min(pages, 10)) + 1):
            params: dict[str, Any] = {"page": page, "limit": max(1, min(limit, 100))}
            if sale_filter != "all":
                params["filter"] = sale_filter
            if order:
                params["order"] = order
            if query:
                params["q"] = query
            if sport:
                params["sport"] = sport
            response = await client.get(BASE_URL, params=params)
            response.raise_for_status()
            decoded = _decode_remix_payload(response.json())
            data = decoded["routes/marketplace"]["data"]
            last_stats = data.get("stats") or {}
            rows.extend(_normalize_sale(sale) for sale in data.get("sales") or [])

    rows.sort(key=lambda row: (row.score, -(row.price or 0)), reverse=True)
    return {
        "count": len(rows),
        "stats": last_stats,
        "results": [asdict(row) for row in rows],
    }
