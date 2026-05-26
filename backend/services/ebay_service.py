import base64
import os
import time
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
        price_obj = item.get("price") or item.get("currentBidPrice") or {}
        price = _to_float(price_obj.get("value"))
        if price is None:
            continue

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

        results.append(
            {
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
                "match_query": params["q"],
                "match_quality": "exact" if params["q"].lower() == query.strip().lower() else "partial",
                "raw": item,
            }
        )

    return {"count": len(results), "results": results, "search_queries": search_queries}
