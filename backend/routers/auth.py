import os

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer

bearer = HTTPBearer()


async def current_user(token=Depends(bearer)) -> dict:
    try:
        supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        supabase_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
        if not supabase_url or not supabase_key:
            raise HTTPException(status_code=500, detail="Supabase auth env is missing")

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {token.credentials}",
                },
            )
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=401, detail=f"invalid_token: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=401, detail=f"invalid_token: {resp.text[:500]}")

    user = resp.json()
    allowed = [email.strip().lower() for email in os.getenv("ALLOWED_EMAILS", "").split(",") if email.strip()]
    email = (user.get("email") or "").lower()
    if allowed and email not in allowed:
        raise HTTPException(status_code=403, detail="not_allowed")

    return user
