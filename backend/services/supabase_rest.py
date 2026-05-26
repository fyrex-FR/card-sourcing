import os
from typing import Any

import httpx
from fastapi import HTTPException

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")


def _headers(prefer: str | None = None) -> dict[str, str]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase env is missing")

    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def table_url(table: str) -> str:
    return f"{SUPABASE_URL}/rest/v1/{table}"


async def request(method: str, table: str, *, params: dict[str, Any] | None = None, json: Any = None, prefer: str | None = None):
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(method, table_url(table), headers=_headers(prefer), params=params, json=json)

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:1000])
    if resp.status_code == 204 or not resp.text:
        return None
    return resp.json()
