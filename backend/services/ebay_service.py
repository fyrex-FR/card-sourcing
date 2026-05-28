import base64
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

EBAY_CLIENT_ID = os.getenv("EBAY_CLIENT_ID", "")
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET", "")

EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"

_token_cache: dict[str, Any] = {"token": None, "expires_at": 0}


async def _get_access_token() -> str | None:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    if not EBAY_CLIENT_ID or not EBAY_CLIENT_SECRET:
        return None

    credentials = base64.b64encode(f"{EBAY_CLIENT_ID}:{EBAY_CLIENT_SECRET}".encode()).decode()

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            EBAY_TOKEN_URL,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "client_credentials",
                "scope": "https://api.ebay.com/oauth/api_scope",
            },
        )
    if resp.status_code != 200:
        return None

    data = resp.json()
    _token_cache["token"] = data.get("access_token")
    _token_cache["expires_at"] = now + data.get("expires_in", 7200)
    return _token_cache["token"]


def _to_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _fallback_queries(query: str) -> list[str]:
    words = query.strip().split()
    fallbacks = []
    if len(words) >= 3:
        # eBay web often shows "results matching fewer words"; Browse API does not
        # reliably do that for us, so keep filters strict and relax only the text.
        fallbacks.append(" ".join(words[:2]))

    seen = {query.strip().lower()}
    unique = []
    for fallback in fallbacks:
        key = fallback.lower()
        if key and key not in seen:
            unique.append(fallback)
            seen.add(key)
    return unique


def _format_ebay_datetime(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _parse_item_summary(item: dict[str, Any], *, match_query: str, original_query: str) -> dict[str, Any] | None:
    price_obj = item.get("price") or item.get("currentBidPrice") or {}
    price = _to_float(price_obj.get("value"))
    if price is None:
        return None

    image = ""
    if item.get("image"):
        image = item["image"].get("imageUrl", "")
    elif item.get("thumbnailImages"):
        image = item["thumbnailImages"][0].get("imageUrl", "")

    seller = item.get("seller") or {}
    location = item.get("itemLocation") or {}
    shipping_options = item.get("shippingOptions") or []
    shipping = None
    if shipping_options:
        shipping = _to_float((shipping_options[0].get("shippingCost") or {}).get("value"))

    return {
        "external_id": item.get("itemId"),
        "title": item.get("title", ""),
        "price": price,
        "currency": price_obj.get("currency", "USD"),
        "shipping_price": shipping,
        "url": item.get("itemWebUrl", ""),
        "image_url": image,
        "seller_username": seller.get("username", ""),
        "seller_feedback": seller.get("feedbackPercentage"),
        "country": location.get("country", ""),
        "condition": item.get("condition", ""),
        "buying_options": item.get("buyingOptions", []),
        "auction_end_at": item.get("itemEndDate"),
        "bid_count": item.get("bidCount"),
        "match_query": match_query,
        "match_quality": "exact" if match_query.lower() == original_query.strip().lower() else "partial",
        "raw": item,
    }


async def search_active_listings(
    query: str,
    *,
    max_results: int = 100,
    marketplace: str = "EBAY_US",
    country_filter: str | None = None,
    max_price: float | None = None,
    buying_option: str | None = None,
) -> dict[str, Any]:
    if not query.strip():
        return {"error": "empty_query", "results": []}

    token = await _get_access_token()
    if not token:
        return {"error": "missing_ebay_token", "results": []}

    filters = []
    if country_filter:
        filters.append(f"itemLocationCountry:{country_filter.upper()}")
    if buying_option and buying_option.upper() != "ALL":
        filters.append(f"buyingOptions:{{{buying_option.upper()}}}")
    if max_price is not None:
        filters.append(f"price:[..{float(max_price)}]")
        filters.append("priceCurrency:USD")

    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
        "Content-Type": "application/json",
    }

    async def fetch(search_query: str) -> tuple[httpx.Response, dict[str, Any]]:
        params = {
            "q": search_query,
            "sort": "price",
            "limit": min(max(max_results, 1), 100),
        }
        if filters:
            params["filter"] = ",".join(filters)
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(EBAY_BROWSE_URL, headers=headers, params=params)
        return resp, params

    resp, params = await fetch(query.strip())
    if resp.status_code != 200:
        return {"error": f"ebay_api_{resp.status_code}", "details": resp.text[:500], "results": []}

    data = resp.json()
    search_queries = [params["q"]]
    if not data.get("itemSummaries"):
        for fallback_query in _fallback_queries(query):
            resp, params = await fetch(fallback_query)
            search_queries.append(params["q"])
            if resp.status_code != 200:
                return {"error": f"ebay_api_{resp.status_code}", "details": resp.text[:500], "results": []}
            data = resp.json()
            if data.get("itemSummaries"):
                break

    results = []
    for item in data.get("itemSummaries", []):
        parsed = _parse_item_summary(item, match_query=params["q"], original_query=query)
        if parsed:
            results.append(parsed)

    return {"count": len(results), "results": results, "search_queries": search_queries}


async def search_seller_ending_auctions(
    seller_username: str,
    *,
    query: str = "card",
    days: int = 30,
    max_results: int = 100,
    marketplace: str = "EBAY_US",
) -> dict[str, Any]:
    seller = seller_username.strip()
    search_query = query.strip() or "card"
    if not seller:
        return {"error": "empty_seller", "results": []}

    token = await _get_access_token()
    if not token:
        return {"error": "missing_ebay_token", "results": []}

    end_at = _format_ebay_datetime(datetime.now(UTC) + timedelta(days=max(1, min(days, 30))))
    filters = [
        f"sellers:{{{seller}}}",
        "buyingOptions:{AUCTION}",
        f"itemEndDate:[..{end_at}]",
    ]
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
        "Content-Type": "application/json",
    }
    params = {
        "q": search_query,
        "sort": "endingSoonest",
        "limit": min(max(max_results, 1), 100),
        "filter": ",".join(filters),
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(EBAY_BROWSE_URL, headers=headers, params=params)
    if resp.status_code != 200:
        return {"error": f"ebay_api_{resp.status_code}", "details": resp.text[:500], "results": []}

    data = resp.json()
    results = []
    for item in data.get("itemSummaries", []):
        parsed = _parse_item_summary(item, match_query=search_query, original_query=search_query)
        if parsed:
            results.append(parsed)

    return {
        "count": len(results),
        "total": data.get("total", len(results)),
        "seller_username": seller,
        "query": search_query,
        "days": days,
        "results": results,
    }


EBAY_ITEM_URL = "https://api.ebay.com/buy/browse/v1/item/{item_id}"


# ATTENTION QUOTA EBAY :
# Browse API en production = 5000 appels/jour par defaut. Au-dela : 429.
# Cette fonction est appelee par notify_scheduler.check_max_bid_exceeded
# pour chaque item bid_planned avec max_bid defini, a chaque tick (5 min).
# Si tu as N items dans la fenetre de 24h : N * 12 ticks/h * 24h = 288 N appels/jour.
#   - 17 items max sans deborder
#   - Si tu approches la limite : reduire MAX_BID_CHECK_WINDOW_MIN, ou
#     espacer le tick (NOTIFY_CHECK_INTERVAL_SECONDS), ou demander un
#     upgrade de quota a eBay.
async def get_item_current_price(external_id: str, *, marketplace: str = "EBAY_US") -> dict[str, Any] | None:
    """
    Recupere le prix actuel + nb d'encheres d'un item via Browse API getItem.
    Renvoie {"price": float, "currency": str, "bid_count": int|None, "auction_end_at": str|None}
    ou None si erreur.
    """
    if not external_id:
        return None
    token = await _get_access_token()
    if not token:
        return None
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(EBAY_ITEM_URL.format(item_id=external_id), headers=headers)
        except httpx.HTTPError:
            return None
    if resp.status_code != 200:
        return None
    data = resp.json()
    price_obj = data.get("price") or data.get("currentBidPrice") or {}
    price = _to_float(price_obj.get("value"))
    if price is None:
        return None
    return {
        "price": price,
        "currency": price_obj.get("currency", "USD"),
        "bid_count": data.get("bidCount"),
        "auction_end_at": data.get("itemEndDate"),
    }
