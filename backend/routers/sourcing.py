from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routers.auth import current_user
from services.discord_service import send_test_notification
from services.ebay_service import search_active_listings, search_seller_ending_auctions
from services.supabase_rest import request

router = APIRouter()


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    query: str = Field(min_length=1, max_length=300)
    max_price: float | None = Field(default=None, ge=0)
    marketplace: str = "EBAY_US"
    country_filter: str = "CN"
    buying_option: Literal["ALL", "AUCTION", "FIXED_PRICE"] = "AUCTION"
    notes: str | None = None


class WatchlistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    query: str | None = Field(default=None, min_length=1, max_length=300)
    max_price: float | None = Field(default=None, ge=0)
    marketplace: str | None = None
    country_filter: str | None = None
    buying_option: Literal["ALL", "AUCTION", "FIXED_PRICE"] | None = None
    notes: str | None = None
    active: bool | None = None


_ITEM_STATUSES = Literal["new", "watching", "in_basket", "bid_planned", "ignored", "bought", "too_expensive"]


class ItemStatusUpdate(BaseModel):
    status: _ITEM_STATUSES


class ItemUpdate(BaseModel):
    status: _ITEM_STATUSES | None = None
    max_bid: float | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)


class SellerFavoriteCreate(BaseModel):
    seller_username: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    shipping_estimate: float | None = Field(default=None, ge=0)


class SellerFavoriteUpdate(BaseModel):
    note: str | None = Field(default=None, max_length=500)
    shipping_estimate: float | None = Field(default=None, ge=0)


class UserSettingsUpdate(BaseModel):
    discord_webhook_url: str | None = Field(default=None, max_length=500)
    notify_minutes_before: int | None = Field(default=None, ge=1, le=240)


class TestNotificationRequest(BaseModel):
    discord_webhook_url: str = Field(min_length=10, max_length=500)


OPTIONAL_ITEM_COLUMNS = {"auction_end_at", "bid_count", "match_query", "match_quality", "max_bid", "note"}
OPTIONAL_FAVORITE_COLUMNS = {"shipping_estimate"}


def _user_id(user: dict) -> str:
    return user.get("sub") or user["id"]


def _without_optional_item_columns(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key not in OPTIONAL_ITEM_COLUMNS}


def _without_optional_favorite_columns(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key not in OPTIONAL_FAVORITE_COLUMNS}


def _is_missing_optional_favorite_column(exc: HTTPException) -> bool:
    detail = str(exc.detail)
    return exc.status_code == 400 and any(column in detail for column in OPTIONAL_FAVORITE_COLUMNS)


def _is_missing_optional_column(exc: HTTPException) -> bool:
    detail = str(exc.detail)
    return exc.status_code == 400 and any(column in detail for column in OPTIONAL_ITEM_COLUMNS)


async def _get_watchlist(watchlist_id: str, user: dict) -> dict[str, Any]:
    rows = await request(
        "GET",
        "sourcing_watchlists",
        params={"id": f"eq.{watchlist_id}", "user_id": f"eq.{_user_id(user)}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="watchlist_not_found")
    return rows[0]


@router.get("/watchlists")
async def list_watchlists(user: dict = Depends(current_user)):
    return await request(
        "GET",
        "sourcing_watchlists",
        params={"user_id": f"eq.{_user_id(user)}", "order": "created_at.desc"},
    )


@router.post("/watchlists", status_code=201)
async def create_watchlist(body: WatchlistCreate, user: dict = Depends(current_user)):
    payload = body.model_dump()
    payload["user_id"] = _user_id(user)
    rows = await request("POST", "sourcing_watchlists", json=payload, prefer="return=representation")
    return rows[0]


@router.patch("/watchlists/{watchlist_id}")
async def update_watchlist(watchlist_id: str, body: WatchlistUpdate, user: dict = Depends(current_user)):
    await _get_watchlist(watchlist_id, user)
    payload = {key: value for key, value in body.model_dump().items() if value is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="empty_update")
    rows = await request(
        "PATCH",
        "sourcing_watchlists",
        params={"id": f"eq.{watchlist_id}", "user_id": f"eq.{_user_id(user)}"},
        json=payload,
        prefer="return=representation",
    )
    return rows[0]


@router.delete("/watchlists/{watchlist_id}", status_code=204)
async def delete_watchlist(watchlist_id: str, user: dict = Depends(current_user)):
    await request(
        "DELETE",
        "sourcing_watchlists",
        params={"id": f"eq.{watchlist_id}", "user_id": f"eq.{_user_id(user)}"},
    )


@router.get("/items")
async def list_items(watchlist_id: str | None = None, status: str | None = None, user: dict = Depends(current_user)):
    params = {"user_id": f"eq.{_user_id(user)}", "order": "first_seen_at.desc", "limit": "1000"}
    if watchlist_id:
        params["watchlist_id"] = f"eq.{watchlist_id}"
    if status:
        params["status"] = f"eq.{status}"
    return await request("GET", "sourcing_items", params=params)


@router.patch("/items/{item_id}/status")
async def update_item_status(item_id: str, body: ItemStatusUpdate, user: dict = Depends(current_user)):
    rows = await request(
        "PATCH",
        "sourcing_items",
        params={"id": f"eq.{item_id}", "user_id": f"eq.{_user_id(user)}"},
        json={"status": body.status},
        prefer="return=representation",
    )
    if not rows:
        raise HTTPException(status_code=404, detail="item_not_found")
    return rows[0]


@router.patch("/items/{item_id}")
async def update_item(item_id: str, body: ItemUpdate, user: dict = Depends(current_user)):
    payload = {key: value for key, value in body.model_dump().items() if value is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="empty_update")
    user_id = _user_id(user)
    try:
        rows = await request(
            "PATCH",
            "sourcing_items",
            params={"id": f"eq.{item_id}", "user_id": f"eq.{user_id}"},
            json=payload,
            prefer="return=representation",
        )
    except HTTPException as exc:
        if not _is_missing_optional_column(exc):
            raise
        cleaned = _without_optional_item_columns(payload)
        if not cleaned:
            raise HTTPException(status_code=400, detail="migration_required")
        rows = await request(
            "PATCH",
            "sourcing_items",
            params={"id": f"eq.{item_id}", "user_id": f"eq.{user_id}"},
            json=cleaned,
            prefer="return=representation",
        )
    if not rows:
        raise HTTPException(status_code=404, detail="item_not_found")
    return rows[0]


@router.get("/seller-favorites")
async def list_seller_favorites(user: dict = Depends(current_user)):
    return await request(
        "GET",
        "sourcing_seller_favorites",
        params={"user_id": f"eq.{_user_id(user)}", "order": "created_at.desc"},
    )


@router.post("/seller-favorites", status_code=201)
async def add_seller_favorite(body: SellerFavoriteCreate, user: dict = Depends(current_user)):
    payload = body.model_dump()
    payload["user_id"] = _user_id(user)
    try:
        rows = await request(
            "POST",
            "sourcing_seller_favorites",
            json=payload,
            prefer="return=representation,resolution=merge-duplicates",
        )
    except HTTPException as exc:
        if not _is_missing_optional_favorite_column(exc):
            raise
        rows = await request(
            "POST",
            "sourcing_seller_favorites",
            json=_without_optional_favorite_columns(payload),
            prefer="return=representation,resolution=merge-duplicates",
        )
    return rows[0] if rows else payload


@router.patch("/seller-favorites/{seller_username}")
async def update_seller_favorite(seller_username: str, body: SellerFavoriteUpdate, user: dict = Depends(current_user)):
    payload = {key: value for key, value in body.model_dump().items() if value is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="empty_update")
    user_id = _user_id(user)
    params = {"seller_username": f"eq.{seller_username}", "user_id": f"eq.{user_id}"}
    try:
        rows = await request(
            "PATCH",
            "sourcing_seller_favorites",
            params=params,
            json=payload,
            prefer="return=representation",
        )
    except HTTPException as exc:
        if not _is_missing_optional_favorite_column(exc):
            raise
        cleaned = _without_optional_favorite_columns(payload)
        if not cleaned:
            raise HTTPException(status_code=400, detail="migration_required")
        rows = await request(
            "PATCH",
            "sourcing_seller_favorites",
            params=params,
            json=cleaned,
            prefer="return=representation",
        )
    if not rows:
        raise HTTPException(status_code=404, detail="favorite_not_found")
    return rows[0]


@router.delete("/seller-favorites/{seller_username}", status_code=204)
async def remove_seller_favorite(seller_username: str, user: dict = Depends(current_user)):
    await request(
        "DELETE",
        "sourcing_seller_favorites",
        params={
            "seller_username": f"eq.{seller_username}",
            "user_id": f"eq.{_user_id(user)}",
        },
    )


@router.get("/sellers/{seller_username}/ending-auctions")
async def seller_ending_auctions(
    seller_username: str,
    query: str = "card",
    days: int = 30,
    marketplace: str = "EBAY_US",
    user: dict = Depends(current_user),
):
    _user_id(user)
    return await search_seller_ending_auctions(
        seller_username,
        query=query,
        days=days,
        marketplace=marketplace,
    )


@router.post("/watchlists/{watchlist_id}/scan")
async def scan_watchlist(watchlist_id: str, user: dict = Depends(current_user)):
    watchlist = await _get_watchlist(watchlist_id, user)
    country_filter = (watchlist.get("country_filter") or "").upper()
    buying_option = (watchlist.get("buying_option") or "ALL").upper()
    max_price = watchlist.get("max_price")
    ebay_data = await search_active_listings(
        watchlist["query"],
        marketplace=watchlist.get("marketplace") or "EBAY_US",
        country_filter=country_filter or None,
        max_price=float(max_price) if max_price is not None else None,
        buying_option=buying_option,
    )
    if ebay_data.get("error"):
        return ebay_data

    user_id = _user_id(user)
    now_iso = datetime.now(timezone.utc).isoformat()
    candidates = []

    for item in ebay_data["results"]:
        if country_filter and (item.get("country") or "").upper() != country_filter:
            continue
        if buying_option != "ALL" and buying_option not in [option.upper() for option in item.get("buying_options", [])]:
            continue
        if max_price is not None and item["price"] > float(max_price):
            continue
        if not item.get("external_id"):
            # Sans external_id pas de dedup possible, on skip pour eviter les doublons
            continue
        candidates.append(item)

    # Upsert en lot via la contrainte unique (user_id, watchlist_id, source, external_id).
    # Le PostgREST resolution=merge-duplicates met a jour les colonnes presentes dans le
    # payload sans toucher aux autres (notamment status, note, max_bid si user en a mis).
    saved: list[dict[str, Any]] = []
    if candidates:
        batch = [
            {
                "user_id": user_id,
                "watchlist_id": watchlist_id,
                "source": "ebay",
                **{key: value for key, value in item.items() if key != "raw"},
                "raw": item.get("raw"),
                "last_seen_at": now_iso,
            }
            for item in candidates
        ]
        on_conflict = "user_id,watchlist_id,source,external_id"
        try:
            saved = await request(
                "POST",
                "sourcing_items",
                params={"on_conflict": on_conflict},
                json=batch,
                prefer="return=representation,resolution=merge-duplicates",
            ) or []
        except HTTPException as exc:
            if not _is_missing_optional_column(exc):
                raise
            cleaned_batch = [_without_optional_item_columns(payload) for payload in batch]
            saved = await request(
                "POST",
                "sourcing_items",
                params={"on_conflict": on_conflict},
                json=cleaned_batch,
                prefer="return=representation,resolution=merge-duplicates",
            ) or []

    await request(
        "PATCH",
        "sourcing_watchlists",
        params={"id": f"eq.{watchlist_id}", "user_id": f"eq.{user_id}"},
        json={"last_scan_at": now_iso},
    )

    return {
        "count": len(saved),
        "scanned_count": ebay_data.get("count", len(ebay_data["results"])),
        "candidate_count": len(candidates),
        "items": saved,
    }


@router.get("/settings")
async def get_user_settings(user: dict = Depends(current_user)):
    user_id = _user_id(user)
    rows = await request(
        "GET",
        "sourcing_user_settings",
        params={"user_id": f"eq.{user_id}", "limit": "1"},
    )
    if rows:
        return rows[0]
    # Renvoie une structure par defaut si pas encore de ligne
    return {
        "user_id": user_id,
        "discord_webhook_url": None,
        "notify_minutes_before": 30,
    }


@router.patch("/settings")
async def update_user_settings(body: UserSettingsUpdate, user: dict = Depends(current_user)):
    payload = {key: value for key, value in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(status_code=400, detail="empty_update")
    user_id = _user_id(user)
    payload["user_id"] = user_id
    rows = await request(
        "POST",
        "sourcing_user_settings",
        json=payload,
        prefer="return=representation,resolution=merge-duplicates",
    )
    return rows[0] if rows else payload


@router.post("/settings/test-notification")
async def test_notification(body: TestNotificationRequest, user: dict = Depends(current_user)):
    _user_id(user)
    ok, message = await send_test_notification(body.discord_webhook_url)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"ok": True}

