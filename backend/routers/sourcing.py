from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routers.auth import current_user
from services.ebay_service import search_active_listings
from services.supabase_rest import request

router = APIRouter()


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    query: str = Field(min_length=1, max_length=300)
    max_price: float | None = Field(default=None, ge=0)
    marketplace: str = "EBAY_US"
    country_filter: str = "CN"
    notes: str | None = None


class WatchlistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    query: str | None = Field(default=None, min_length=1, max_length=300)
    max_price: float | None = Field(default=None, ge=0)
    marketplace: str | None = None
    country_filter: str | None = None
    notes: str | None = None
    active: bool | None = None


class ItemStatusUpdate(BaseModel):
    status: Literal["new", "watching", "ignored", "bought", "too_expensive"]


def _user_id(user: dict) -> str:
    return user.get("sub") or user["id"]


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
    params = {"user_id": f"eq.{_user_id(user)}", "order": "first_seen_at.desc", "limit": "200"}
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


@router.post("/watchlists/{watchlist_id}/scan")
async def scan_watchlist(watchlist_id: str, user: dict = Depends(current_user)):
    watchlist = await _get_watchlist(watchlist_id, user)
    ebay_data = await search_active_listings(watchlist["query"], marketplace=watchlist.get("marketplace") or "EBAY_US")
    if ebay_data.get("error"):
        return ebay_data

    user_id = _user_id(user)
    country_filter = (watchlist.get("country_filter") or "").upper()
    max_price = watchlist.get("max_price")
    candidates = []

    for item in ebay_data["results"]:
        if country_filter and (item.get("country") or "").upper() != country_filter:
            continue
        if max_price is not None and item["price"] > float(max_price):
            continue
        candidates.append(item)

    saved = []
    for item in candidates:
        existing = await request(
            "GET",
            "sourcing_items",
            params={
                "user_id": f"eq.{user_id}",
                "watchlist_id": f"eq.{watchlist_id}",
                "external_id": f"eq.{item.get('external_id')}",
                "limit": "1",
            },
        )
        payload = {
            "user_id": user_id,
            "watchlist_id": watchlist_id,
            **{key: value for key, value in item.items() if key != "raw"},
            "source": "ebay",
            "raw": item.get("raw"),
        }
        if existing:
            rows = await request(
                "PATCH",
                "sourcing_items",
                params={"id": f"eq.{existing[0]['id']}", "user_id": f"eq.{user_id}"},
                json={**payload, "last_seen_at": datetime.now(timezone.utc).isoformat()},
                prefer="return=representation",
            )
        else:
            rows = await request("POST", "sourcing_items", json=payload, prefer="return=representation")
        saved.append(rows[0])

    await request(
        "PATCH",
        "sourcing_watchlists",
        params={"id": f"eq.{watchlist_id}", "user_id": f"eq.{user_id}"},
        json={"last_scan_at": datetime.now(timezone.utc).isoformat()},
    )

    return {"count": len(saved), "items": saved}
